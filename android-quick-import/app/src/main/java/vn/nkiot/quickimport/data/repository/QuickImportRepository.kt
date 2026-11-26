package vn.nkiot.quickimport.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import vn.nkiot.quickimport.data.local.DraftDao
import vn.nkiot.quickimport.data.local.ImportDraftEntity
import vn.nkiot.quickimport.data.model.CancelImportPayload
import vn.nkiot.quickimport.data.model.CommandResponse
import vn.nkiot.quickimport.data.model.DataViewResponse
import vn.nkiot.quickimport.data.model.DraftContent
import vn.nkiot.quickimport.data.model.DraftItem
import vn.nkiot.quickimport.data.model.DraftPhoto
import vn.nkiot.quickimport.data.model.ExchangeImportPayload
import vn.nkiot.quickimport.data.model.GenericCommandEnvelope
import vn.nkiot.quickimport.data.model.ImeiDetailPayload
import vn.nkiot.quickimport.data.model.ImportCommandEnvelope
import vn.nkiot.quickimport.data.model.ImportItemPayload
import vn.nkiot.quickimport.data.model.ImportPayload
import vn.nkiot.quickimport.data.model.ProductDto
import vn.nkiot.quickimport.data.model.ReturnImportItemPayload
import vn.nkiot.quickimport.data.model.ReturnImportPayload
import vn.nkiot.quickimport.data.model.StoreDataDto
import vn.nkiot.quickimport.data.model.SupplierDto
import vn.nkiot.quickimport.data.model.TablePatch
import vn.nkiot.quickimport.data.remote.ApiException
import vn.nkiot.quickimport.data.remote.NkiotApiClient
import vn.nkiot.quickimport.data.remote.SessionStore
import java.io.File
import java.util.UUID

sealed interface SubmitResult {
    data class Success(val code: String, val response: CommandResponse) : SubmitResult
    data class UncertainNetwork(val requestId: String, val message: String) : SubmitResult
    data class RevisionConflict(val message: String) : SubmitResult
    data class Error(val message: String) : SubmitResult
}

class QuickImportRepository(
    private val api: NkiotApiClient,
    private val sessionStore: SessionStore,
    private val draftDao: DraftDao
) {
    val draftsFlow: Flow<List<ImportDraftEntity>> = draftDao.observeAll()

    val isLoggedIn: Boolean
        get() = sessionStore.isLoggedIn

    val savedServerUrl: String
        get() = sessionStore.serverUrl

    val savedUsername: String
        get() = sessionStore.username

    fun resolveMediaUrl(url: String): String = api.resolveMediaUrl(url)

    fun currentCookieHeader(): String? = api.currentCookieHeader()

    fun loadCachedCatalog(): Pair<StoreDataDto, Long>? {
        val raw = sessionStore.lastCatalogJson ?: return null
        val data = runCatching { api.json.decodeFromString<StoreDataDto>(raw) }.getOrNull() ?: return null
        return data to sessionStore.lastRevision
    }

    private fun cacheCatalog(data: StoreDataDto?, revision: Long) {
        if (data != null) {
            sessionStore.lastCatalogJson = api.json.encodeToString(data)
        }
        if (revision > 0) {
            sessionStore.lastRevision = revision
        }
    }

    suspend fun login(serverUrl: String, username: String, password: String): DataViewResponse {
        val response = api.login(serverUrl, username, password)
        cacheCatalog(response.data, response.revision)
        return response
    }

    suspend fun refreshCatalog(): DataViewResponse {
        val response = api.fetchData()
        cacheCatalog(response.data, response.revision)
        return response
    }

    suspend fun logout() {
        api.logout()
    }

    suspend fun saveDraft(draftId: String, content: DraftContent): ImportDraftEntity {
        val title = when {
            content.supplierName.isNotBlank() -> content.supplierName
            content.items.isNotEmpty() -> content.items.first().productName
            else -> "Phiếu nhập nháp"
        }
        val entity = ImportDraftEntity(
            id = draftId,
            title = title,
            branchName = content.branchName,
            supplierName = content.supplierName,
            itemCount = content.items.size,
            totalUnits = content.totalUnits,
            totalAmount = content.totalAmount,
            hasPendingRequest = !content.pendingRequestId.isNullOrBlank(),
            contentJson = api.json.encodeToString(content),
            updatedAt = System.currentTimeMillis()
        )
        draftDao.upsert(entity)
        return entity
    }

    suspend fun loadDraft(draftId: String): DraftContent? {
        val entity = draftDao.getById(draftId) ?: return null
        return runCatching { api.json.decodeFromString<DraftContent>(entity.contentJson) }.getOrNull()
    }

    suspend fun deleteDraft(draftId: String) {
        draftDao.deleteById(draftId)
    }

    private suspend fun uploadPhotoList(photos: List<DraftPhoto>, label: String): List<DraftPhoto> {
        return photos.map { photo ->
            if (!photo.remoteUrl.isNullOrBlank()) {
                photo
            } else {
                val uploadedUrl = api.uploadImageFile(File(photo.localPath))
                photo.copy(remoteUrl = uploadedUrl)
            }
        }
    }

    /**
     * Uploads any local inspection/product photos that don't yet have a remote `/uploads/...` URL,
     * saves updated draft so uploads aren't repeated, then submits `POST /api/command` with a stable `requestId`.
     */
    suspend fun submitDraft(
        draftId: String,
        content: DraftContent,
        currentRevision: Long,
        onDraftUpdated: suspend (DraftContent) -> Unit
    ): SubmitResult {
        val validationError = validateDraftForSubmit(content)
        if (validationError != null) return SubmitResult.Error(validationError)

        // Step 1: Upload all pending local photos (both IMEI and non-IMEI)
        var workingContent = content
        val uploadedItems = mutableListOf<DraftItem>()
        for (item in workingContent.items) {
            val updatedProductPhotos = try {
                uploadPhotoList(item.photos, item.productCode)
            } catch (e: ApiException) {
                return SubmitResult.Error("Lỗi tải ảnh sản phẩm (${item.productCode}): ${e.message}")
            }

            val updatedDetails = item.imeiDetails.toMutableMap()
            for ((imei, detail) in item.imeiDetails) {
                val updatedPhotos = try {
                    uploadPhotoList(detail.photos, imei)
                } catch (e: ApiException) {
                    return SubmitResult.Error("Lỗi tải ảnh kiểm định ($imei): ${e.message}")
                }
                updatedDetails[imei] = detail.copy(photos = updatedPhotos)
            }
            uploadedItems += item.copy(photos = updatedProductPhotos, imeiDetails = updatedDetails)
        }

        // Step 2: Lock requestId & revision into draft BEFORE calling `/api/command`
        val requestId = workingContent.pendingRequestId ?: newRequestId()
        val revisionToUse = workingContent.pendingRevision ?: currentRevision
        workingContent = workingContent.copy(
            items = uploadedItems,
            pendingRequestId = requestId,
            pendingRevision = revisionToUse
        )
        saveDraft(draftId, workingContent)
        onDraftUpdated(workingContent)

        // Step 3: Build NKiot `import` command envelope
        val envelope = buildCommandEnvelope(requestId, revisionToUse, workingContent)

        return try {
            val response = api.submitImport(envelope)
            cacheCatalog(response.data, response.revision)
            val code = response.result?.get("code")?.toString()?.trim('"') ?: "PN"
            deleteDraft(draftId)
            SubmitResult.Success(code, response)
        } catch (e: ApiException) {
            when {
                e.isNetworkError -> SubmitResult.UncertainNetwork(requestId, e.message)
                e.statusCode == 409 -> {
                    val unlocked = workingContent.copy(pendingRequestId = null, pendingRevision = null)
                    saveDraft(draftId, unlocked)
                    onDraftUpdated(unlocked)
                    SubmitResult.RevisionConflict(e.message)
                }
                else -> {
                    val unlocked = workingContent.copy(pendingRequestId = null, pendingRevision = null)
                    saveDraft(draftId, unlocked)
                    onDraftUpdated(unlocked)
                    SubmitResult.Error(e.message)
                }
            }
        }
    }

    suspend fun verifyPendingRequest(draftId: String, requestId: String): SubmitResult {
        return try {
            val response = api.checkRequestStatus(requestId)
            cacheCatalog(response.data, response.revision)
            val code = response.result?.get("code")?.toString()?.trim('"') ?: "PN"
            deleteDraft(draftId)
            SubmitResult.Success(code, response)
        } catch (e: ApiException) {
            if (e.statusCode == 409) {
                SubmitResult.Error(
                    "Máy chủ chưa ghi nhận phiếu cho mã giao dịch này. Anh có thể tải lại dữ liệu và thử gửi lại."
                )
            } else {
                SubmitResult.Error(e.message)
            }
        }
    }

    // --- Web Parity Operations: Cancel, Return, Exchange, Quick-Add Supplier & Product ---

    suspend fun cancelImport(
        importId: String,
        reason: String,
        refundMethod: String,
        revision: Long
    ): SubmitResult {
        val payload = api.json.encodeToJsonElement(
            CancelImportPayload(importId = importId, reason = reason.trim(), refundMethod = refundMethod)
        )
        return sendTypedCommand("cancel_import", payload, revision, fallbackCode = importId)
    }

    suspend fun returnImport(
        importId: String,
        items: List<ReturnImportItemPayload>,
        refundMethod: String,
        reason: String,
        revision: Long
    ): SubmitResult {
        val payload = api.json.encodeToJsonElement(
            ReturnImportPayload(
                importId = importId,
                items = items,
                refundMethod = refundMethod,
                reason = reason.trim()
            )
        )
        return sendTypedCommand("return_import", payload, revision, fallbackCode = "PTN")
    }

    suspend fun exchangeImport(
        importId: String,
        returnItems: List<ReturnImportItemPayload>,
        exchangeItems: List<ImportItemPayload>,
        method: String,
        reason: String,
        revision: Long
    ): SubmitResult {
        val payload = api.json.encodeToJsonElement(
            ExchangeImportPayload(
                importId = importId,
                returnItems = returnItems,
                exchangeItems = exchangeItems,
                method = method,
                reason = reason.trim()
            )
        )
        return sendTypedCommand("exchange_import", payload, revision, fallbackCode = "DH")
    }

    suspend fun createSupplier(supplier: SupplierDto, revision: Long): SubmitResult {
        val tablesObj = buildJsonObject {
            put("suppliers", api.json.encodeToJsonElement(TablePatch(upsert = listOf(supplier))))
        }
        val payload = buildJsonObject {
            put("tables", tablesObj)
            put("settings", JsonObject(emptyMap()))
        }
        return sendTypedCommand("catalogPatch", payload, revision, fallbackCode = supplier.code)
    }

    suspend fun createProduct(product: ProductDto, revision: Long): SubmitResult {
        val tablesObj = buildJsonObject {
            put("products", api.json.encodeToJsonElement(TablePatch(upsert = listOf(product))))
        }
        val payload = buildJsonObject {
            put("tables", tablesObj)
            put("settings", JsonObject(emptyMap()))
        }
        return sendTypedCommand("catalogPatch", payload, revision, fallbackCode = product.code)
    }

    private suspend fun sendTypedCommand(
        type: String,
        payload: kotlinx.serialization.json.JsonElement,
        revision: Long,
        fallbackCode: String
    ): SubmitResult {
        val envelope = GenericCommandEnvelope(
            requestId = newRequestId(),
            revision = revision,
            type = type,
            payload = payload
        )
        return try {
            val response = api.sendRawCommand(api.json.encodeToString(envelope))
            cacheCatalog(response.data, response.revision)
            val code = response.result?.get("code")?.toString()?.trim('"') ?: fallbackCode
            SubmitResult.Success(code, response)
        } catch (e: ApiException) {
            when {
                e.statusCode == 409 -> SubmitResult.RevisionConflict(e.message)
                else -> SubmitResult.Error(e.message)
            }
        }
    }

    companion object {
        fun newRequestId(): String = "and-${UUID.randomUUID().toString().replace("-", "")}"

        fun generateNextCode(existingCodes: Collection<String>, prefix: String, minPad: Int): String {
            val regex = Regex("^${Regex.escape(prefix)}(\\d+)$", RegexOption.IGNORE_CASE)
            var maxNum = 0
            var padLen = minPad
            val upperExisting = existingCodes.map { it.uppercase() }.toSet()
            for (c in existingCodes) {
                val m = regex.matchEntire(c.trim()) ?: continue
                val num = m.groupValues[1].toIntOrNull() ?: continue
                if (num > maxNum) maxNum = num
                if (m.groupValues[1].length > padLen) padLen = m.groupValues[1].length
            }
            var next = maxNum + 1
            var candidate = "$prefix${next.toString().padStart(padLen, '0')}"
            while (candidate.uppercase() in upperExisting) {
                next++
                candidate = "$prefix${next.toString().padStart(padLen, '0')}"
            }
            return candidate
        }

        fun parseBulkImeis(rawText: String): List<String> {
            return rawText
                .split(Regex("[\\r\\n,;\\s]+"))
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
        }

        fun validateDraftForSubmit(content: DraftContent): String? {
            if (content.branchName.isBlank()) return "Vui lòng chọn kho nhận hàng."
            if (content.supplierCode.isBlank()) return "Vui lòng chọn nhà cung cấp."
            if (content.items.isEmpty()) return "Phiếu nhập đang trống."
            val seenImeis = mutableSetOf<String>()
            for (item in content.items) {
                if (item.effectiveQty <= 0) {
                    return if (item.hasImei) {
                        "Sản phẩm ${item.productName} chưa quét IMEI/Serial nào."
                    } else {
                        "Số lượng sản phẩm ${item.productName} phải lớn hơn 0."
                    }
                }
                if (item.unitPrice < 0) return "Đơn giá sản phẩm ${item.productName} không hợp lệ."
                if (item.hasImei) {
                    for (imei in item.imeis) {
                        if (imei.isBlank() || !seenImeis.add(imei)) {
                            return "IMEI '$imei' bị trống hoặc trùng trong phiếu."
                        }
                    }
                }
            }
            if (content.paidAmount > content.totalAmount) {
                return "Tiền trả nhà cung cấp vượt quá tổng tiền nhập."
            }
            return null
        }

        fun buildCommandEnvelope(
            requestId: String,
            revision: Long,
            content: DraftContent
        ): ImportCommandEnvelope {
            val payloadItems = content.items.map { item ->
                val detailMap = if (item.hasImei) {
                    item.imeis.mapNotNull { imei ->
                        val d = item.imeiDetails[imei] ?: return@mapNotNull null
                        val urls = d.photos.mapNotNull { it.remoteUrl }.filter { it.isNotBlank() }
                        if (urls.isEmpty() && d.condition == null && d.conditionDetail.isBlank()) {
                            null
                        } else {
                            imei to ImeiDetailPayload(
                                images = urls,
                                condition = d.condition?.apiValue,
                                conditionDetail = d.conditionDetail.trim()
                            )
                        }
                    }.toMap()
                } else {
                    emptyMap()
                }

                val productImages = if (!item.hasImei) {
                    item.photos.mapNotNull { it.remoteUrl }.filter { it.isNotBlank() }
                } else {
                    emptyList()
                }

                ImportItemPayload(
                    code = item.productCode,
                    qty = item.effectiveQty,
                    price = item.unitPrice,
                    hasImei = item.hasImei,
                    imeis = if (item.hasImei) item.imeis else emptyList(),
                    imeiDetails = detailMap,
                    images = productImages,
                    condition = item.condition?.apiValue ?: "new",
                    conditionDetail = item.conditionDetail.trim()
                )
            }

            return ImportCommandEnvelope(
                requestId = requestId,
                revision = revision,
                type = "import",
                payload = ImportPayload(
                    branch = content.branchName,
                    supplierCode = content.supplierCode,
                    items = payloadItems,
                    paid = content.paidAmount,
                    paymentMethod = content.paymentMethod.apiValue,
                    note = content.note.trim(),
                    copiedFrom = content.copiedFrom.trim()
                )
            )
        }
    }
}
