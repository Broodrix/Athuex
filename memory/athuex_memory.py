"""
athuex_memory.py - Version 1.0.0
Unified Thue memory engine + persistent storage + LLM RAG integration.

"""

import json
import os
import re
import tempfile
import threading
from typing import Dict, Optional

__version__ = "1.0.0"
__all__ = [
    "AthuexMemory",
    # Backwards-compatible aliases:
    "CompleteThueMemoryEngine", "AutoThueMemoryManager",
    "NativeThueFileMemory", "PersistentThueMemory", "ThueMemoryEngine",
]


class AthuexMemory:
    """Unified persistent Thue rewrite memory engine."""

    _RULE_RE = re.compile(r"\[NEW_RULE:\s*(.*?)\s*::=\s*(.*?)\]", re.DOTALL)
    _MUTATE_RE = re.compile(r"\[MUTATE:\s*(.*?)\s*\]", re.DOTALL)

    def __init__(
        self,
        storage_path: str = "athuex_memory.json",
        state_path: Optional[str] = None,
        initial_state: str = "",
        initial_rules: Optional[Dict[str, str]] = None,
    ):
        self.storage_path = storage_path
        self.state_path = state_path
        self._lock = threading.RLock()
        self.rules: Dict[str, str] = {}
        self.state: str = initial_state

        if initial_rules:
            for k, v in initial_rules.items():
                self._validate_and_set(k, v)

        self.load()

    # ---------- Validation ----------
    def _validate_and_set(self, lhs: str, rhs: str) -> bool:
        if not isinstance(lhs, str) or not isinstance(rhs, str):
            return False
        if lhs == "":
            # Empty LHS would loop forever on any state (including empty).
            return False
        self.rules[lhs] = rhs
        return True

    # ---------- Atomic persistence ----------
    def _atomic_write(self, path: str, content: str) -> None:
        d = os.path.dirname(os.path.abspath(path)) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".athuex_")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except Exception:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            raise

    def load(self) -> None:
        with self._lock:
            if os.path.exists(self.storage_path):
                try:
                    with open(self.storage_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        rules = data.get("rules") or {}
                        if isinstance(rules, dict):
                            self.rules.clear()
                            for k, v in rules.items():
                                self._validate_and_set(str(k), str(v))
                        if self.state_path is None:
                            s = data.get("state")
                            if isinstance(s, str):
                                self.state = s
                except (json.JSONDecodeError, OSError) as e:
                    print(f"⚠️ athuex_memory: could not load {self.storage_path}: {e}")

            if self.state_path and os.path.exists(self.state_path):
                try:
                    with open(self.state_path, "r", encoding="utf-8") as f:
                        self.state = f.read()
                except OSError as e:
                    print(f"⚠️ athuex_memory: could not load {self.state_path}: {e}")

    def save(self) -> None:
        with self._lock:
            payload = {"version": __version__, "rules": self.rules}
            if self.state_path is None:
                payload["state"] = self.state
            self._atomic_write(
                self.storage_path,
                json.dumps(payload, indent=2, ensure_ascii=False),
            )
            if self.state_path:
                self._atomic_write(self.state_path, self.state)

    # ---------- Rule management ----------
    def add_rule(self, lhs: str, rhs: str, *, save: bool = True) -> bool:
        with self._lock:
            ok = self._validate_and_set(lhs, rhs)
            if ok and save:
                self.save()
            return ok

    def bulk_add_rules(self, rules: Dict[str, str], *, save: bool = True) -> int:
        count = 0
        with self._lock:
            for lhs, rhs in rules.items():
                if self._validate_and_set(lhs, rhs):
                    count += 1
            if count and save:
                self.save()
        return count

    def remove_rule(self, lhs: str, *, save: bool = True) -> bool:
        with self._lock:
            if lhs in self.rules:
                del self.rules[lhs]
                if save:
                    self.save()
                return True
            return False

    # ---------- Thue operations ----------
    def get_applicable_rules(self) -> Dict[str, str]:
        """Rules whose LHS currently exists in the state string."""
        return {lhs: rhs for lhs, rhs in self.rules.items() if lhs in self.state}

    def step(self, lhs: Optional[str] = None, *, save: bool = True) -> bool:
        """Apply one rewrite. If lhs is None, apply the first applicable rule."""
        with self._lock:
            if lhs is None:
                applicable = list(self.get_applicable_rules().items())
                if not applicable:
                    return False
                lhs, rhs = applicable[0]
            else:
                if lhs not in self.rules or lhs not in self.state:
                    return False
                rhs = self.rules[lhs]
            self.state = self.state.replace(lhs, rhs, 1)
            if save:
                self.save()
            return True

    def step_to_fixpoint(self, max_iterations: int = 10_000) -> int:
        """Run rewrite steps until no rule applies. Returns number of steps executed."""
        n = 0
        while n < max_iterations and self.step(save=False):
            n += 1
        if n:
            self.save()
        return n

    def set_state(self, new_state: str, *, save: bool = True) -> None:
        with self._lock:
            self.state = new_state
            if save:
                self.save()

    # ---------- Native .thue file format ----------
    def load_thue_file(self, path: str) -> None:
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        rules: Dict[str, str] = {}
        state_lines = []
        parsing_rules = True
        for line in lines:
            stripped = line.rstrip("\n").strip()
            if not stripped:
                continue
            if parsing_rules and stripped == "::=":
                parsing_rules = False
                continue
            if parsing_rules:
                if "::=" in stripped:
                    lhs, rhs = stripped.split("::=", 1)
                    if lhs.strip():
                        rules[lhs.strip()] = rhs.strip()
            else:
                state_lines.append(stripped)
        with self._lock:
            self.rules = rules
            self.state = " ".join(state_lines)
        self.save()

    def save_thue_file(self, path: str) -> None:
        with self._lock:
            lines = [f"{lhs}::={rhs}" for lhs, rhs in self.rules.items()]
            lines.append("::=")
            lines.append(self.state)
            self._atomic_write(path, "\n".join(lines) + "\n")

    # ---------- LLM response parsing ----------
    def process_llm_response(self, raw_text: str) -> str:
        """
        Parses [NEW_RULE: lhs ::= rhs] and [MUTATE: lhs] tags from LLM output,
        registers rules, executes mutations, saves, and returns the cleaned text.
        """
        rules_added = 0
        mutations_done = 0
        with self._lock:
            for lhs, rhs in self._RULE_RE.findall(raw_text):
                if self._validate_and_set(lhs.strip(), rhs.strip()):
                    rules_added += 1
            for trigger in self._MUTATE_RE.findall(raw_text):
                key = trigger.strip()
                if key in self.rules and key in self.state:
                    self.state = self.state.replace(key, self.rules[key], 1)
                    mutations_done += 1
            if rules_added or mutations_done:
                self.save()
        if rules_added or mutations_done:
            print(f"💾 athuex_memory: +{rules_added} rules, {mutations_done} mutations applied.")
        clean = self._RULE_RE.sub("", raw_text)
        clean = self._MUTATE_RE.sub("", clean)
        return clean.strip()

    # ---------- RAG context for LLM prompt ----------
    def get_rag_context(self) -> str:
        with self._lock:
            applicable = self.get_applicable_rules()
            lines = [
                f"CURRENT MEMORY STATE: {self.state}",
                "ACTIVE MEMORY CONSTRAINTS:",
            ]
            if not applicable:
                lines.append(" - (none)")
            else:
                for lhs, rhs in applicable.items():
                    lines.append(f" - If '{lhs}' is true, it transforms into '{rhs}'")
            return "\n".join(lines)

    # ---------- Introspection ----------
    def __repr__(self) -> str:
        return (
            f"AthuexMemory(v{__version__}, rules={len(self.rules)}, "
            f"state_len={len(self.state)})"
        )


# ------------------------------------------------------------------
# Backwards-compatible aliases (same class, unified behavior)
# ------------------------------------------------------------------
CompleteThueMemoryEngine = AthuexMemory
AutoThueMemoryManager  = AthuexMemory
NativeThueFileMemory   = AthuexMemory
PersistentThueMemory   = AthuexMemory
ThueMemoryEngine       = AthuexMemory


# ------------------------------------------------------------------
# Self-test
# ------------------------------------------------------------------
if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        m = AthuexMemory(
            storage_path=os.path.join(td, "m.json"),
            initial_state="user_pref::coffee user_mood::neutral",
            initial_rules={
                "user_pref::coffee":  "user_beverage::hot_espresso",
                "user_mood::neutral": "user_mood::engaged",
            },
        )
        assert m.step("user_pref::coffee") is True
        assert "hot_espresso" in m.state
        assert m.step("user_mood::neutral") is True
        assert "engaged" in m.state

        out = m.process_llm_response(
            "Hi there! "
            "[NEW_RULE: greeting::hi ::= greeting::hello] "
            "[MUTATE: greeting::hi]"
        )
        assert "[NEW_RULE" not in out and "[MUTATE" not in out
        assert "greeting::hi" in m.rules

        thue = os.path.join(td, "m.thue")
        m.save_thue_file(thue)
        m2 = AthuexMemory(
            storage_path=os.path.join(td, "m2.json"),
            initial_state="x",
        )
        m2.load_thue_file(thue)
        assert m2.rules == m.rules
        assert m2.state == m.state

        print("✅ athuex_memory.py self-test passed.")
        print(m.get_rag_context())