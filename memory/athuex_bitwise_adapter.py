"""athuex_bitwise_adapter.py

Bridges AthuexMemory (string rules) to a compact integer-mask runtime.

Fixes over qbitwise.py:
  - 32-bit token IDs (no 255-token ceiling)
  - Correct replacement semantics (LHS removed, RHS added)
  - Rules stored as plain dict[int, int] — no spatial packing overhead
  - Explicit re-sync when AthuexMemory rules change
  - step() returns per-pass mutation count and reaches a real fixpoint
"""

from __future__ import annotations
from typing import Dict, Optional
import threading


class BitwiseThueRuntime:
    """Integer-mask rewrite engine. Restricted to single-token LHS."""

    def __init__(self) -> None:
        self._id_to_token: Dict[int, str] = {}
        self._token_to_id: Dict[str, int] = {}
        self._next_id: int = 1                 # 0 reserved as "absent"
        self._rules: Dict[int, int] = {}       # lhs_id -> rhs_id
        self._state: Dict[int, int] = {}       # token_id -> 0 (sentinel)
        self._lock = threading.RLock()

    # ---------- ID allocation ----------
    def _get_id(self, token: str) -> int:
        tid = self._token_to_id.get(token)
        if tid is None:
            tid = self._next_id
            self._next_id += 1
            self._token_to_id[token] = tid
            self._id_to_token[tid] = token
        return tid

    # ---------- Sync from AthuexMemory ----------
    def sync_from_memory(self, memory) -> None:
        """Rebuild rules and state from an AthuexMemory instance."""
        with self._lock:
            self._rules.clear()
            for lhs, rhs in memory.rules.items():
                lhs_tok, rhs_tok = lhs.strip(), rhs.strip()
                if not lhs_tok or not rhs_tok:
                    continue
                self._rules[self._get_id(lhs_tok)] = self._get_id(rhs_tok)
            self._state.clear()
            for tok in memory.state.split():
                self._state[self._get_id(tok.strip())] = 0

    # ---------- Step ----------
    def step(self) -> int:
        """Apply every rule whose LHS token is present, once. Returns count."""
        with self._lock:
            applied = 0
            for lhs_id, rhs_id in self._rules.items():
                if lhs_id in self._state:
                    del self._state[lhs_id]
                    self._state[rhs_id] = 0
                    applied += 1
            return applied

    def step_to_fixpoint(self, max_iterations: int = 10_000) -> int:
        total = 0
        for _ in range(max_iterations):
            n = self.step()
            if n == 0:
                break
            total += n
        return total

    # ---------- Export ----------
    def export_state_string(self) -> str:
        with self._lock:
            return " ".join(
                self._id_to_token[tid]
                for tid in self._state
                if tid in self._id_to_token
            )

    def stats(self) -> Dict[str, int]:
        return {
            "tokens": len(self._token_to_id),
            "rules": len(self._rules),
            "state_size": len(self._state),
        }


if __name__ == "__main__":
    import os, tempfile
    from athuex_memory import AthuexMemory

    with tempfile.TemporaryDirectory() as td:
        mem = AthuexMemory(
            storage_path=os.path.join(td, "m.json"),
            initial_state="user_pref::coffee user_mood::neutral location::home",
            initial_rules={
                "user_pref::coffee":  "user_beverage::hot_espresso",
                "user_mood::neutral": "user_mood::engaged",
                "location::home":     "environment::quiet_mode",
            },
        )
        rt = BitwiseThueRuntime()
        rt.sync_from_memory(mem)

        print("before:", rt.export_state_string())
        n = rt.step()
        print(f"applied {n} rules in one pass")
        print("after :", rt.export_state_string())

        assert n == 3
        assert rt.step() == 0            # fixpoint reached
        assert "user_beverage::hot_espresso" in rt.export_state_string()
        print("✅ adapter self-test passed")