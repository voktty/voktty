package app.voktty.voktty

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.math.max

class MainActivity : TauriActivity() {
  companion object {
    const val TAG = "VokttyBack"
  }

  @Volatile
  var backConsumedByJs = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    WebView.setWebContentsDebuggingEnabled(true)

    window.statusBarColor = Color.BLACK
    window.navigationBarColor = Color.BLACK

    requestStoragePermissions()

    // Hide navigation bar (immersive sticky — swipe to temporarily show).
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.navigationBars())

    // Adjust insets for IME keyboard
    val rootView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())

      v.setPadding(0, 0, 0, max(0, ime.bottom - bars.bottom))

      val wv = findWebViewRecursive(window.decorView)
      if (wv != null) {
        wv.post {
          wv.evaluateJavascript(
            "try{window.dispatchEvent(new Event('resize'));}catch(e){}",
            null
          )
        }
      }
      insets
    }

    // Add JS interface so frontend can manage the Android Back button
    window.decorView.postDelayed({
      val wv = findWebViewRecursive(window.decorView)
      if (wv != null) {
        wv.addJavascriptInterface(BackInterface(this), "VokttyBack")
        Log.i(TAG, "VokttyBack JS interface added to WebView")
      } else {
        Log.w(TAG, "WebView not found — retrying in 500ms")
        window.decorView.postDelayed({
          val wv2 = findWebViewRecursive(window.decorView)
          if (wv2 != null) {
            wv2.addJavascriptInterface(BackInterface(this), "VokttyBack")
            Log.i(TAG, "VokttyBack JS interface added (retry)")
          } else {
            Log.e(TAG, "WebView not found after retry")
          }
        }, 500)
      }
    }, 500)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        Log.d(TAG, "handleOnBackPressed: backConsumedByJs=$backConsumedByJs")
        if (backConsumedByJs) {
          val wv = findWebViewRecursive(window.decorView)
          wv?.evaluateJavascript("if(window.__vokttyHandleBack) window.__vokttyHandleBack();", null)
        } else {
          finish()
        }
      }
    })
  }

  inner class BackInterface(private val activity: MainActivity) {
    @JavascriptInterface
    fun setConsumed(value: Boolean) {
      Log.d(TAG, "setConsumed: $value")
      activity.backConsumedByJs = value
    }
  }

  private fun requestStoragePermissions() {
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      if (!android.os.Environment.isExternalStorageManager()) {
        try {
          val intent = android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
            data = android.net.Uri.parse("package:$packageName")
          }
          startActivity(intent)
        } catch (e: Exception) {
          try {
            val intent = android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
            startActivity(intent)
          } catch (e2: Exception) {
            Log.e(TAG, "Failed to launch manage all files permission settings", e2)
          }
        }
      }
    } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
      val permissions = arrayOf(
        android.Manifest.permission.READ_EXTERNAL_STORAGE,
        android.Manifest.permission.WRITE_EXTERNAL_STORAGE
      )
      val needed = permissions.filter {
        checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED
      }
      if (needed.isNotEmpty()) {
        requestPermissions(needed.toTypedArray(), 1001)
      }
    }
  }

  private fun findWebViewRecursive(view: android.view.View): WebView? {
    if (view is WebView) return view
    if (view is android.view.ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebViewRecursive(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
