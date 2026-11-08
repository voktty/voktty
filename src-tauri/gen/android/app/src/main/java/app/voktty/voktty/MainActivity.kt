package app.voktty.voktty

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
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

  private var pendingPermissionRequest: PermissionRequest? = null
  private val CAMERA_PERMISSION_REQUEST_CODE = 1002

  private fun configureWebView(wv: WebView) {
    wv.setBackgroundColor(Color.parseColor("#121214"))
    wv.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    wv.overScrollMode = View.OVER_SCROLL_NEVER
    wv.isVerticalScrollBarEnabled = false
    wv.isHorizontalScrollBarEnabled = false
    wv.settings.apply {
      domStorageEnabled = true
      databaseEnabled = true
      mediaPlaybackRequiresUserGesture = false
      displayZoomControls = false
      builtInZoomControls = false
      setSupportZoom(false)
      cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
    }
    wv.addJavascriptInterface(BackInterface(this), "VokttyBack")
    wv.addJavascriptInterface(CompanionKeyStore(), "VokttyCompanionKeyStore")
    wv.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        runOnUiThread {
          val resources = request.resources
          val needsCamera = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
          if (needsCamera) {
            val hasPermission = checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
            if (hasPermission) {
              request.grant(resources)
            } else {
              pendingPermissionRequest = request
              requestPermissions(arrayOf(android.Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST_CODE)
            }
          } else {
            request.grant(resources)
          }
        }
      }
    }
    Log.i(TAG, "WebView configured with JS interfaces and WebChromeClient")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.parseColor("#121214")))
    window.decorView.setBackgroundColor(Color.parseColor("#121214"))

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

    // Add JS interface and native GPU settings for WebView with fast discovery
    val immediateWv = findWebViewRecursive(window.decorView)
    if (immediateWv != null) {
      configureWebView(immediateWv)
    } else {
      window.decorView.post {
        val wv = findWebViewRecursive(window.decorView)
        if (wv != null) {
          configureWebView(wv)
        } else {
          window.decorView.postDelayed({
            val wv2 = findWebViewRecursive(window.decorView)
            if (wv2 != null) {
              configureWebView(wv2)
            } else {
              Log.w(TAG, "WebView not found after retry")
            }
          }, 150)
        }
      }
    }

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

  class CompanionKeyStore {
    private val alias = "voktty-companion-device-key"
    @JavascriptInterface fun ensureKey(): Boolean {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      if (store.containsAlias(alias)) return true
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generator.generateKey(); return true
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

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == CAMERA_PERMISSION_REQUEST_CODE) {
      val granted = grantResults.isNotEmpty() && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
      runOnUiThread {
        if (granted) {
          pendingPermissionRequest?.let { it.grant(it.resources) }
        } else {
          pendingPermissionRequest?.deny()
        }
        pendingPermissionRequest = null
      }
    }
  }
}
