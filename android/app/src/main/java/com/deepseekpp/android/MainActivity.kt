package com.deepseekpp.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: DeepSeekPlusPlusBridge
    private var bridgeInstalled = false
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null
    private val bridgeExecutor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue<Runnable>(BRIDGE_QUEUE_CAPACITY),
        ThreadFactory { runnable -> Thread(runnable, "DeepSeekPP-AndroidBridge") },
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = DeepSeekPlusPlusBridge(applicationContext)
        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = deepSeekChromeClient()
            webViewClient = deepSeekWebViewClient()
        }
        bridgeInstalled = installBridge()

        setContentView(webView)
        webView.loadUrl(intent?.data?.toString()?.takeIf(DeepSeekNavigationPolicy::isTrustedOrigin)
            ?: getString(R.string.deepseek_url))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.data?.toString() ?: return
        if (DeepSeekNavigationPolicy.isTrustedOrigin(url)) webView.loadUrl(url)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onDestroy() {
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        if (bridgeInstalled) {
            WebViewCompat.removeWebMessageListener(webView, AndroidBridgeContract.BRIDGE_NAME)
        }
        bridgeInstalled = false
        bridgeExecutor.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity result kept minimal until Android picker abstraction lands.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILE_CHOOSER) return
        val callback = pendingFileChooser ?: return
        pendingFileChooser = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    }

    private fun deepSeekChromeClient() = object : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            pendingFileChooser?.onReceiveValue(null)
            pendingFileChooser = filePathCallback
            return try {
                val intent = fileChooserParams?.createIntent()
                if (intent == null) {
                    pendingFileChooser = null
                    return false
                }
                startActivityForResult(intent, REQUEST_FILE_CHOOSER)
                true
            } catch (error: Throwable) {
                pendingFileChooser = null
                Log.w(TAG, "file chooser failed", error)
                false
            }
        }
    }

    private fun deepSeekWebViewClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url?.toString() ?: return true
            return when (DeepSeekNavigationPolicy.classify(url)) {
                DeepSeekNavigationPolicy.Destination.INTERNAL -> false
                DeepSeekNavigationPolicy.Destination.REJECT -> true
                DeepSeekNavigationPolicy.Destination.EXTERNAL -> {
                    if (request.isForMainFrame) openExternal(url)
                    true
                }
            }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (!bridgeInstalled || !DeepSeekNavigationPolicy.isTrustedOrigin(url)) return
            injectDeepSeekPlusPlusBundle()
        }
    }

    private fun installBridge(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.e(TAG, "Android bridge disabled: WEB_MESSAGE_LISTENER is unavailable")
            return false
        }
        WebViewCompat.addWebMessageListener(
            webView,
            AndroidBridgeContract.BRIDGE_NAME,
            setOf(DeepSeekNavigationPolicy.TRUSTED_ORIGIN),
        ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
            if (!isMainFrame || !DeepSeekNavigationPolicy.isTrustedOrigin(sourceOrigin.toString())) {
                Log.w(TAG, "Rejected Android bridge message from $sourceOrigin")
                return@addWebMessageListener
            }
            if (message.type != WebMessageCompat.TYPE_STRING || message.data == null) {
                Log.w(TAG, "Rejected non-string Android bridge message")
                return@addWebMessageListener
            }
            val data = message.data!!
            try {
                bridgeExecutor.execute {
                    val response = bridge.dispatch(data)
                    webView.post {
                        if (!bridgeInstalled) return@post
                        try {
                            replyProxy.postMessage(response)
                        } catch (error: Throwable) {
                            Log.w(TAG, "Android bridge response failed", error)
                        }
                    }
                }
            } catch (_: RejectedExecutionException) {
                replyProxy.postMessage(bridge.reject(data, "android_bridge_busy"))
            }
        }
        return true
    }

    private fun openExternal(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (error: Throwable) {
            Log.w(TAG, "external navigation blocked after launch failure: $url", error)
        }
    }

    private fun injectDeepSeekPlusPlusBundle() {
        injectAsset("android-bridge-shim.js")
        injectAsset("content-scripts/main-world.js")
        injectAsset("content-scripts/content.js")
    }

    private fun injectAsset(path: String) {
        try {
            val script = assets.open("dpp/$path").bufferedReader().use { it.readText() }
            webView.evaluateJavascript("$script\n//# sourceURL=android_asset/dpp/$path", null)
        } catch (error: Throwable) {
            Log.w(TAG, "missing or invalid asset: $path", error)
        }
    }

    companion object {
        private const val TAG = "DeepSeekPP"
        private const val REQUEST_FILE_CHOOSER = 4201
        private const val BRIDGE_QUEUE_CAPACITY = 32
    }
}
