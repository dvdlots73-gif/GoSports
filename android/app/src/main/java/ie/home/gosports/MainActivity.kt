package ie.home.gosports

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

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
            loadUrl(home)
        }
        setContentView(FrameLayout(this).apply { fitsSystemWindows = true; setBackgroundColor(bg); addView(web) })
    }

    // Lets the page see it's hidden, so it stops polling scores in the background and refreshes on return.
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }
}
