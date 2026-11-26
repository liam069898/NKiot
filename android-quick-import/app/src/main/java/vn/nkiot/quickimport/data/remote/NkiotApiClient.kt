package vn.nkiot.quickimport.data.remote

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import vn.nkiot.quickimport.data.model.ApiErrorResponse
import vn.nkiot.quickimport.data.model.CommandResponse
import vn.nkiot.quickimport.data.model.DataViewResponse
import vn.nkiot.quickimport.data.model.ImportCommandEnvelope
import vn.nkiot.quickimport.data.model.LoginRequest
import vn.nkiot.quickimport.data.model.UploadMediaRequest
import vn.nkiot.quickimport.data.model.UploadMediaResponse
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(
    val statusCode: Int,
    override val message: String,
    val isNetworkError: Boolean = false
) : Exception(message)

class NkiotApiClient(
    private val sessionStore: SessionStore
) {
    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        isLenient = true
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl(): String {
        val url = sessionStore.serverUrl
        if (url.isBlank()) throw ApiException(0, "Chưa cấu hình địa chỉ máy chủ NKiot.")
        return url
    }

    private fun Request.Builder.withSession(includeCsrf: Boolean = false): Request.Builder {
        sessionStore.sessionToken?.let { token ->
            header("Cookie", "minikiot_session=$token")
        }
        if (includeCsrf) {
            sessionStore.csrfToken?.let { csrf ->
                header("x-nkiot-csrf", csrf)
            }
        }
        return this
    }

    private fun extractSessionCookie(headers: List<String>): String? {
        for (header in headers) {
            val parts = header.split(';')
            val pair = parts.firstOrNull()?.trim() ?: continue
            if (pair.startsWith("minikiot_session=")) {
                return pair.removePrefix("minikiot_session=").trim()
            }
        }
        return null
    }

    private fun parseError(statusCode: Int, bodyText: String): ApiException {
        val parsed = runCatching { json.decodeFromString<ApiErrorResponse>(bodyText) }.getOrNull()
        val msg = parsed?.error?.takeIf { it.isNotBlank() } ?: "Lỗi máy chủ (HTTP $statusCode)"
        return ApiException(statusCode, msg)
    }

    suspend fun login(serverUrl: String, username: String, password: String): DataViewResponse =
        withContext(Dispatchers.IO) {
            val normalized = SessionStore.normalizeUrl(serverUrl)
            sessionStore.serverUrl = normalized
            sessionStore.username = username.trim()

            val payload = json.encodeToString(LoginRequest(username.trim(), password, remember = true))
            val request = Request.Builder()
                .url("$normalized/api/login")
                .post(payload.toRequestBody(jsonMediaType))
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    val bodyText = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw parseError(response.code, bodyText)
                    }
                    val cookieToken = extractSessionCookie(response.headers("Set-Cookie"))
                    val parsed = json.decodeFromString<DataViewResponse>(bodyText)
                    if (!parsed.success || cookieToken.isNullOrBlank() || parsed.csrfToken.isNullOrBlank()) {
                        throw ApiException(response.code, parsed.error ?: "Đăng nhập thất bại.")
                    }
                    sessionStore.sessionToken = cookieToken
                    sessionStore.csrfToken = parsed.csrfToken
                    sessionStore.lastRevision = parsed.revision
                    parsed
                }
            } catch (e: IOException) {
                throw ApiException(0, "Không kết nối được tới máy chủ $normalized (${e.message})", isNetworkError = true)
            }
        }

    suspend fun fetchData(): DataViewResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl()}/api/data")
            .withSession(includeCsrf = false)
            .get()
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val bodyText = response.body?.string().orEmpty()
                if (response.code == 401) {
                    sessionStore.clearSession()
                    throw ApiException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
                }
                if (!response.isSuccessful) {
                    throw parseError(response.code, bodyText)
                }
                val parsed = json.decodeFromString<DataViewResponse>(bodyText)
                parsed.csrfToken?.let { sessionStore.csrfToken = it }
                sessionStore.lastRevision = parsed.revision
                parsed
            }
        } catch (e: IOException) {
            throw ApiException(0, "Mất kết nối tới máy chủ NKiot.", isNetworkError = true)
        }
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("${baseUrl()}/api/logout")
                .withSession(includeCsrf = true)
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            client.newCall(request).execute().close()
        }
        sessionStore.clearSession()
    }

    /**
     * Compresses a local image file (max 1600px, JPEG 82%) and uploads it to NKiot's `/api/upload-media`.
     * Returns the relative server URL (e.g. `/uploads/173..._abc.jpg`).
     */
    suspend fun uploadImageFile(file: File): String = withContext(Dispatchers.IO) {
        if (!file.exists()) {
            throw ApiException(0, "Không tìm thấy tệp ảnh cục bộ: ${file.name}")
        }
        val jpegBytes = compressToJpeg(file)
        val base64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
        val payload = json.encodeToString(
            UploadMediaRequest(
                data = "data:image/jpeg;base64,$base64",
                type = "image/jpeg"
            )
        )
        val request = Request.Builder()
            .url("${baseUrl()}/api/upload-media")
            .withSession(includeCsrf = true)
            .post(payload.toRequestBody(jsonMediaType))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val bodyText = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw parseError(response.code, bodyText)
                }
                val parsed = json.decodeFromString<UploadMediaResponse>(bodyText)
                parsed.url ?: throw ApiException(response.code, parsed.error ?: "Tải ảnh lên thất bại.")
            }
        } catch (e: IOException) {
            throw ApiException(0, "Lỗi mạng khi tải ảnh lên máy chủ.", isNetworkError = true)
        }
    }

    suspend fun submitImport(envelope: ImportCommandEnvelope): CommandResponse =
        sendRawCommand(json.encodeToString(envelope))

    suspend fun sendRawCommand(jsonBody: String): CommandResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("${baseUrl()}/api/command")
                .withSession(includeCsrf = true)
                .post(jsonBody.toRequestBody(jsonMediaType))
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    val bodyText = response.body?.string().orEmpty()
                    if (response.code == 401) {
                        sessionStore.clearSession()
                        throw ApiException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
                    }
                    if (!response.isSuccessful) {
                        throw parseError(response.code, bodyText)
                    }
                    val parsed = json.decodeFromString<CommandResponse>(bodyText)
                    if (parsed.revision > 0) {
                        sessionStore.lastRevision = parsed.revision
                    }
                    parsed
                }
            } catch (e: IOException) {
                throw ApiException(
                    0,
                    "Mất phản hồi từ máy chủ sau khi gửi. Hãy bấm 'Kiểm tra kết quả' để tránh ghi trùng.",
                    isNetworkError = true
                )
            }
        }

    fun resolveMediaUrl(relativeOrAbsolute: String): String {
        val trimmed = relativeOrAbsolute.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        return "${sessionStore.serverUrl.trimEnd('/')}/${trimmed.trimStart('/')}"
    }

    fun currentCookieHeader(): String? =
        sessionStore.sessionToken?.takeIf { it.isNotBlank() }?.let { "minikiot_session=$it" }

    suspend fun checkRequestStatus(requestId: String): CommandResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("${baseUrl()}/api/requests/$requestId")
                .withSession(includeCsrf = false)
                .get()
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    val bodyText = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw parseError(response.code, bodyText)
                    }
                    json.decodeFromString<CommandResponse>(bodyText)
                }
            } catch (e: IOException) {
                throw ApiException(0, "Không kết nối được máy chủ để kiểm tra giao dịch.", isNetworkError = true)
            }
        }

    private fun compressToJpeg(file: File, maxDimension: Int = 1600, quality: Int = 82): ByteArray {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, opts)
        var sampleSize = 1
        while (opts.outWidth / sampleSize > maxDimension * 2 || opts.outHeight / sampleSize > maxDimension * 2) {
            sampleSize *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val bitmap = BitmapFactory.decodeFile(file.absolutePath, decodeOpts)
            ?: return file.readBytes()

        val scaled = if (bitmap.width > maxDimension || bitmap.height > maxDimension) {
            val ratio = minOf(maxDimension.toFloat() / bitmap.width, maxDimension.toFloat() / bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * ratio).toInt().coerceAtLeast(1),
                (bitmap.height * ratio).toInt().coerceAtLeast(1),
                true
            ).also { if (it != bitmap) bitmap.recycle() }
        } else {
            bitmap
        }

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        scaled.recycle()
        return out.toByteArray()
    }
}
