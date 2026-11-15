package com.athuex.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileOutputStream

/**
 * Athuex v2.11.5-native — OS bridge: SurfaceView, reliable IME, SAF GGUF picker, density.
 *
 * IME design (industry pattern used by mobile ImGui / game engines):
 * - Transparent (alpha=0) but VISIBLE EditText so the system IME attaches reliably.
 * - showKeyboard always on UI thread + post{} so focus settles before showSoftInput.
 * - IME edits are diffed and forwarded in one native batch; WantTextInput is polled in C++.
 * - Never call View/IME APIs from the C++ render thread.
 */
class MainActivity : AppCompatActivity(), SurfaceHolder.Callback {

    private lateinit var surfaceView: SurfaceView
    private lateinit var hiddenInput: EditText
    private var internalTextLock = false
    private var lastForwardedText = ""
    private lateinit var modelsDir: File
    /** true = copy into app models dir; false = try use path in-place (Preserve Space) */
    @Volatile private var modelImportMode: Boolean = false

    companion object {
        init {
            try {
                System.loadLibrary("athuex_native")
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.e("Athuex", "Failed to load libathuex_native.so", e)
                throw e
            }
        }
    }

    private external fun nativeOnCreate(storagePath: String)
    private external fun nativeSetDensity(density: Float, scaledDensity: Float)
    private external fun nativeOnDestroy()
    private external fun nativeSurfaceCreated(surface: Any)
    private external fun nativeSurfaceChanged(width: Int, height: Int)
    private external fun nativeSurfaceDestroyed()
    private external fun nativeOnTouchEvent(action: Int, x: Float, y: Float)
    private external fun nativeInjectTextDelta(deleteCount: Int, suffix: String)
    private external fun nativeClearInputBuffer()
    private external fun nativeOnModelPicked(path: String)

    /** SAF: user picks a .gguf from Downloads or anywhere accessible. */
    private val pickGguf = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@registerForActivityResult
        try {
            contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: SecurityException) {
            /* some providers do not support persistable grants */
        }
        val importMode = modelImportMode
        Thread {
            val path: String? = if (importMode) {
                copyUriToModels(uri)?.absolutePath
            } else {
                // Preserve Space: try resolve real path without duplicating the file
                resolveReadablePath(uri) ?: run {
                    // Fallback: if we cannot get a stable path, still import once
                    android.util.Log.w("Athuex", "Run mode: no direct path — importing once")
                    copyUriToModels(uri)?.absolutePath
                }
            }
            runOnUiThread {
                if (path != null) {
                    android.util.Log.i("Athuex", "GGUF ready (${if (importMode) "import" else "run"}): $path")
                    nativeOnModelPicked(path)
                    val label = File(path).name
                    Toast.makeText(
                        this,
                        if (importMode) "Imported: $label" else "Run (no copy): $label",
                        Toast.LENGTH_SHORT
                    ).show()
                } else {
                    Toast.makeText(this, "Failed to open GGUF", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val base = getExternalFilesDir(null) ?: filesDir
        modelsDir = File(base, "models")
        if (!modelsDir.exists()) modelsDir.mkdirs()
        val readme = File(modelsDir, "README_PUT_GGUF_HERE.txt")
        if (!readme.exists()) {
            readme.writeText(
                "Athuex models folder\n" +
                "Use Browse in-app, or copy a Q4_K_M .gguf here.\n" +
                "Path: ${modelsDir.absolutePath}\n"
            )
        }
        android.util.Log.i("Athuex", "models dir: ${modelsDir.absolutePath}")
        nativeOnCreate(modelsDir.absolutePath)

        val dm = resources.displayMetrics
        nativeSetDensity(dm.density, dm.scaledDensity)
        android.util.Log.i("Athuex", "density=${dm.density} scaled=${dm.scaledDensity}")

        /* Transparent but VISIBLE EditText — many Samsung / Android IMEs refuse
         * to attach to View.INVISIBLE. alpha=0 keeps it invisible to the user. */
        /* Single-line full-width hidden EditText: avoids DynamicLayout wrapping
         * an entire prompt into an 8px column on every keystroke (major UI-thread cost). */
        hiddenInput = EditText(this).apply {
            visibility = View.VISIBLE
            alpha = 0f
            isFocusable = true
            isFocusableInTouchMode = true
            isCursorVisible = false
            isSingleLine = true
            setHorizontallyScrolling(true)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or
                EditorInfo.IME_FLAG_NO_FULLSCREEN or
                EditorInfo.IME_ACTION_SEND
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                8
            )
        }

        surfaceView = SurfaceView(this)
        surfaceView.holder.addCallback(this)

        val root = FrameLayout(this)
        root.addView(surfaceView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        root.addView(hiddenInput)
        setContentView(root)

        surfaceView.setOnTouchListener { _, event ->
            // Forward all pointer actions; C++ maps them to ImGui mouse events
            nativeOnTouchEvent(event.actionMasked, event.x, event.y)
            true
        }

        /* Diff the full text so composition, selection replacement and paste work.
         * Each resulting edit is forwarded to native as one batch. */
        hiddenInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (internalTextLock || s == null) return
                // Fast path: pure append at end of buffer (typical typing) — no full toString()
                if (before == 0 && start == lastForwardedText.length) {
                    val added = s.subSequence(start, start + count).toString()
                    lastForwardedText += added
                    nativeInjectTextDelta(0, added)
                    return
                }
                val text = s.toString()
                forwardTextDelta(lastForwardedText, text)
                lastForwardedText = text
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        // TextWatcher is the single source of truth for soft and hardware input.
        // A separate DEL/ENTER key listener double-applied edits on several IMEs.
    }

    /**
     * Emit one batched edit. Prefix comparison never splits a UTF-16 surrogate pair;
     * native converts the suffix into Unicode code points before feeding ImGui.
     */
    private fun forwardTextDelta(from: String, to: String) {
        var i = 0
        val minLen = minOf(from.length, to.length)
        while (i < minLen && from[i] == to[i]) i++
        if (i > 0 && i < from.length && Character.isHighSurrogate(from[i - 1])) i--
        if (i > 0 && i < to.length && Character.isHighSurrogate(to[i - 1])) i--
        val deleteCount = from.codePointCount(i, from.length)
        val suffix = to.substring(i)
        if (deleteCount != 0 || suffix.isNotEmpty()) {
            nativeInjectTextDelta(deleteCount, suffix)
        }
    }

    /**
     * Called from native (any thread). Always hops to UI thread.
     * Sequence: ensure visible → requestFocus → post showSoftInput (focus must settle).
     */
    @Suppress("unused")
    fun showKeyboard() {
        runOnUiThread {
            try {
                if (!::hiddenInput.isInitialized) return@runOnUiThread
                hiddenInput.visibility = View.VISIBLE
                hiddenInput.alpha = 0f
                hiddenInput.requestFocus()
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                // Samsung IMEs may reject the first request while SurfaceView focus settles.
                // Retry asynchronously; never use toggleSoftInput (it can close an open IME).
                hiddenInput.post {
                    try {
                        imm.showSoftInput(hiddenInput, InputMethodManager.SHOW_IMPLICIT)
                        hiddenInput.postDelayed({
                            try {
                                if (!isFinishing && hiddenInput.hasFocus()) {
                                    // Idempotent show request; unlike toggle, it cannot dismiss an open IME.
                                    imm.showSoftInput(hiddenInput, InputMethodManager.SHOW_IMPLICIT)
                                }
                            } catch (e: Exception) {
                                android.util.Log.e("Athuex", "IME retry failed", e)
                            }
                        }, 180L)
                    } catch (e: Exception) {
                        android.util.Log.e("Athuex", "IME display failed", e)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("Athuex", "showKeyboard", e)
            }
        }
    }

    /** Called from native when generation starts so IME buffer and ImGui stay aligned. */
    @Suppress("unused")
    fun clearComposer() {
        runOnUiThread {
            try {
                if (!::hiddenInput.isInitialized) return@runOnUiThread
                internalTextLock = true
                try {
                    hiddenInput.setText("")
                    lastForwardedText = ""
                } finally {
                    internalTextLock = false
                }
            } catch (e: Exception) {
                internalTextLock = false
                android.util.Log.e("Athuex", "clearComposer", e)
            }
        }
    }

    @Suppress("unused")
    fun hideKeyboard() {
        runOnUiThread {
            try {
                if (!::hiddenInput.isInitialized) return@runOnUiThread
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(hiddenInput.windowToken, 0)
                hiddenInput.clearFocus()
                internalTextLock = true
                try {
                    hiddenInput.setText("")
                    lastForwardedText = ""
                    nativeClearInputBuffer()
                } finally {
                    internalTextLock = false
                }
            } catch (e: Exception) {
                internalTextLock = false
                android.util.Log.e("Athuex", "hideKeyboard", e)
            }
        }
    }

    /** Called from C++ when user taps Browse. */
    @Suppress("unused")
    /** JNI zero-arg → Run (no copy / Preserve Space) */
    fun openGgufPicker() {
        openGgufPicker(false)
    }

    /** @param importMode true = copy into app models/; false = Prefer path without copy */
    fun openGgufPicker(importMode: Boolean) {
        modelImportMode = importMode
        runOnUiThread {
            try {
                pickGguf.launch(arrayOf("*/*", "application/octet-stream"))
            } catch (e: Exception) {
                android.util.Log.e("Athuex", "openGgufPicker", e)
                Toast.makeText(this, "Cannot open file picker", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun copyUriToModels(uri: Uri): File? {
        return try {
            var name = "model.gguf"
            contentResolver.query(uri, null, null, null, null)?.use { c ->
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && c.moveToFirst()) {
                    val n = c.getString(idx)
                    if (!n.isNullOrBlank()) name = n
                }
            }
            if (!name.lowercase().endsWith(".gguf")) name = "$name.gguf"
            name = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val dest = File(modelsDir, name)
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(dest).use { output -> input.copyTo(output) }
            } ?: return null
            if (dest.length() < 1024) {
                dest.delete()
                return null
            }
            dest
        } catch (e: Exception) {
            android.util.Log.e("Athuex", "copyUriToModels", e)
            null
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        nativeSurfaceCreated(holder.surface)
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        nativeSurfaceChanged(width, height)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        nativeSurfaceDestroyed()
    }

    override fun onDestroy() {
        nativeOnDestroy()
        super.onDestroy()
    }
}
