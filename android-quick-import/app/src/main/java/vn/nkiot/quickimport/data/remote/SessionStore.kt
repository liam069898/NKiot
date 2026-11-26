package vn.nkiot.quickimport.data.remote

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists NKiot server URL, session cookie (`minikiot_session`), and CSRF token across restarts.
 */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("nkiot_quick_import_session", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL).orEmpty()
        set(value) = prefs.edit().putString(KEY_SERVER_URL, normalizeUrl(value)).apply()

    var username: String
        get() = prefs.getString(KEY_USERNAME, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_USERNAME, value).apply()

    var sessionToken: String?
        get() = prefs.getString(KEY_SESSION_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_SESSION_TOKEN, value).apply()

    var csrfToken: String?
        get() = prefs.getString(KEY_CSRF_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_CSRF_TOKEN, value).apply()

    var lastCatalogJson: String?
        get() = prefs.getString(KEY_CATALOG_JSON, null)
        set(value) = prefs.edit().putString(KEY_CATALOG_JSON, value).apply()

    var lastRevision: Long
        get() = prefs.getLong(KEY_REVISION, 0L)
        set(value) = prefs.edit().putLong(KEY_REVISION, value).apply()

    val isLoggedIn: Boolean
        get() = !sessionToken.isNullOrBlank() && !csrfToken.isNullOrBlank()

    fun clearSession() {
        prefs.edit()
            .remove(KEY_SESSION_TOKEN)
            .remove(KEY_CSRF_TOKEN)
            .apply()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_USERNAME = "username"
        private const val KEY_SESSION_TOKEN = "session_token"
        private const val KEY_CSRF_TOKEN = "csrf_token"
        private const val KEY_CATALOG_JSON = "catalog_json"
        private const val KEY_REVISION = "revision"
        const val DEFAULT_SERVER_URL = "https://kalo.nkiot.site"

        fun normalizeUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            if (trimmed.isEmpty()) return ""
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
        }
    }
}
