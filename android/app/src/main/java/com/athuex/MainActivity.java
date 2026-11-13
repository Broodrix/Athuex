package com.athuex;

/**
 * LEGACY — do not use.
 * Production activity is com.athuex.app.MainActivity (Kotlin).
 * Kept only so old references do not break compilation; exported=false in manifest.
 * Will be removed in a future cleanup phase.
 */
@Deprecated
public class MainActivity extends android.app.Activity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        finish(); // never launch
    }
}
