package ie.home.gosports

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import kotlin.concurrent.thread

/** Shows the live GoSports site, so pushes to GitHub reach the app without a reinstall. */
class MainActivity : Activity() {
    private val home = "https://dvdlots73-gif.github.io/GoSports/"
    private val bg = 0xFF0F1115.toInt()
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // favourites and remembered tabs live in localStorage
            setBackgroundColor(bg)
            webViewClient = object : WebViewClient() {
                // news articles and forum threads open in the phone's browser, not inside the app
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    if (req.url.toString().startsWith(home)) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, req.url)) }
                    return true
                }
            }
            addJavascriptInterface(Bridge(), "Android")
            loadUrl(home)
        }
        setContentView(FrameLayout(this).apply { fitsSystemWindows = true; setBackgroundColor(bg); addView(web) })

        Alerts.channels(this)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        thread { Alerts.plan(this) }
    }

    /** The site tells the app which football teams to alert for: followed teams plus ★ favourites. */
    inner class Bridge {
        @JavascriptInterface
        fun setAlertTeams(json: String) {
            val a = JSONArray(json)
            Alerts.setTeams(this@MainActivity, (0 until a.length()).map(a::getString).toSet())
        }
    }

    // Lets the page see it's hidden, so it stops polling scores in the background and refreshes on return.
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }
}
