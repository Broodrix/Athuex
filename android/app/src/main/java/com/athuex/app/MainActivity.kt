package com.athuex.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.KeyEvent
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
 * Athuex v2.11.1-native — OS bridge: SurfaceView, reliable IME, SAF GGUF picker, density.
 *
 * IME design (industry pattern used by mobile ImGui / game engines):
 * - Transparent (alpha=0) but VISIBLE EditText so the system IME attaches reliably.
 * - showKeyboard always on UI thread + post{} so focus settles before showSoftInput.
 * - Text changes forwarded to native via nativeInjectChar; WantTextInput polled in C++.
 * - Never call View/IME APIs from the C++ render thread.
 */
class MainActivity : AppCompatActivity(), SurfaceHolder.Callback {

    private lateinit var surfaceView: SurfaceView
    private lateinit var hiddenInput: EditText
    private var internalTextLock = false
    private var lastForwardedText = ""
    private lateinit var modelsDir: File

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
    private external fun nativeInjectChar(unicodeChar: Int)
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
            /* some providers do not support persistable grants — copy still works */
        }
        Thread {
            val dest = copyUriToModels(uri)
            runOnUiThread {
                if (dest != null) {
                    android.util.Log.i("Athuex", "GGUF picked → ${dest.absolutePath}")
                    nativeOnModelPicked(dest.absolutePath)
                    Toast.makeText(this, "Model ready: ${dest.name}", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Failed to import GGUF", Toast.LENGTH_LONG).show()
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
        hiddenInput = EditText(this).apply {
            visibility = View.VISIBLE
            alpha = 0f
            isFocusable = true
            isFocusableInTouchMode = true
            isCursorVisible = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or
                EditorInfo.IME_FLAG_NO_FULLSCREEN
            // Small but non-zero size so OEMs still treat it as a real focus target
            layoutParams = FrameLayout.LayoutParams(8, 8)
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

        /* Robust text forwarder: compare full previous string, emit chars / backspaces.
         * Handles IME composition, selection replace, and multi-char pastes better than
         * length-only diff. */
        hiddenInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (internalTextLock) return
                val text = s?.toString() ?: return
                forwardTextDelta(lastForwardedText, text)
                lastForwardedText = text
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        // Hardware / soft-key DEL and ENTER as backup path
        hiddenInput.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
            when (keyCode) {
                KeyEvent.KEYCODE_DEL -> {
                    nativeInjectChar(8)
                    true
                }
                KeyEvent.KEYCODE_ENTER -> {
                    nativeInjectChar(10)
                    true
                }
                else -> false
            }
        }
    }

    /**
     * Emit the minimal sequence of injectChar calls that turns [from] into [to].
     * Simple common-prefix algorithm — production-safe for mobile IME.
     */
    private fun forwardTextDelta(from: String, to: String) {
        var i = 0
        val minLen = minOf(from.length, to.length)
        while (i < minLen && from[i] == to[i]) i++
        // delete trailing difference
        repeat(from.length - i) { nativeInjectChar(8) }
        // insert new suffix
        for (j in i until to.length) {
            nativeInjectChar(to[j].code)
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
                hiddenInput.post {
                    try {
                        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                        val shown = imm.showSoftInput(hiddenInput, InputMethodManager.SHOW_IMPLICIT)
                        android.util.Log.d("Athuex", "IME show request accepted: $shown")
                        if (!shown) {
                            // Fallback for some Samsung builds
                            imm.toggleSoftInput(InputMethodManager.SHOW_FORCED, 0)
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("Athuex", "IME display failed", e)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("Athuex", "showKeyboard", e)
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
                hiddenInput.setText("")
                lastForwardedText = ""
                nativeClearInputBuffer()
                internalTextLock = false
            } catch (e: Exception) {
                android.util.Log.e("Athuex", "hideKeyboard", e)
            }
        }
    }

    /** Called from C++ when user taps Browse. */
    @Suppress("unused")
    fun openGgufPicker() {
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
