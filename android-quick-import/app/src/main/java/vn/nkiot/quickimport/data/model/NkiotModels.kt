package vn.nkiot.quickimport.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// --- Server Snapshot & Auth DTOs ---

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val remember: Boolean = true
)

@Serializable
data class ApiErrorResponse(
    val success: Boolean = false,
    val error: String = "Lỗi không xác định"
)

@Serializable
data class UserDto(
    val id: String = "",
    val username: String = "",
    val name: String = "",
    val role: String = "",
    val branch: String = "",
    val branches: List<String> = emptyList(),
    val status: String = "active",
    val permissions: Map<String, Boolean> = emptyMap()
)

@Serializable
data class BranchDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val phone: String = "",
    val address: String = "",
    val isDefault: Boolean = false
)

@Serializable
data class CategoryDto(
    val id: String = "",
    val code: String = "",
    val name: String = ""
)

@Serializable
data class SupplierDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val phone: String = "",
    val address: String = "",
    val debt: Long = 0L,
    val totalBought: Long = 0L
)

@Serializable
data class ProductDto(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val category: String = "",
    val costPrice: Long = 0L,
    val price: Long = 0L,
    val stock: Int = 0,
    val minStock: Int = 0,
    val unit: String = "",
    val status: String = "active",
    val barcode: String = "",
    val branch: String = "",
    val hasImei: Boolean = false,
    val imeis: List<String> = emptyList(),
    val images: List<String> = emptyList()
)

@Serializable
data class TransferItemDto(
    val code: String = "",
    val imeis: List<String> = emptyList()
)

@Serializable
data class TransferDto(
    val id: String = "",
    val status: String = "",
    val items: List<TransferItemDto> = emptyList()
)

@Serializable
data class ImeiDetailDto(
    val images: List<String> = emptyList(),
    val condition: String = "",
    val conditionDetail: String = "",
    val videoUrl: String = ""
)

@Serializable
data class ImportItemDto(
    val code: String = "",
    val name: String = "",
    val qty: Int = 0,
    val price: Long = 0L,
    val total: Long = 0L,
    val hasImei: Boolean = false,
    val imeis: List<String> = emptyList(),
    val imeiDetails: Map<String, ImeiDetailDto> = emptyMap(),
    val images: List<String> = emptyList(),
    val condition: String = "",
    val conditionDetail: String = ""
)

@Serializable
data class ImportRecordDto(
    val id: String = "",
    val code: String = "",
    val time: String = "",
    val createdAt: String = "",
    val nccCode: String = "",
    val nccName: String = "",
    val supplierId: String = "",
    val items: List<ImportItemDto> = emptyList(),
    val needPay: Long = 0L,
    val paid: Long = 0L,
    val paymentMethod: String = "cash",
    val note: String = "",
    val status: String = "imported",
    val creator: String = "",
    val branch: String = "",
    val cancelReason: String = "",
    val cancelTime: String = "",
    val copiedFrom: String = "",
    val copiedBy: String = ""
)

@Serializable
data class ImportReturnItemDto(
    val code: String = "",
    val name: String = "",
    val qty: Int = 0,
    val price: Long = 0L,
    val total: Long = 0L,
    val hasImei: Boolean = false,
    val imeis: List<String> = emptyList()
)

@Serializable
data class ImportReturnDto(
    val id: String = "",
    val code: String = "",
    val importCode: String = "",
    val time: String = "",
    val createdAt: String = "",
    val nccCode: String = "",
    val nccName: String = "",
    val items: List<ImportReturnItemDto> = emptyList(),
    val totalRefund: Long = 0L,
    val debtReduced: Long = 0L,
    val cashBack: Long = 0L,
    val reason: String = "",
    val creator: String = "",
    val branch: String = ""
)

@Serializable
data class StoreDataDto(
    val products: List<ProductDto> = emptyList(),
    val suppliers: List<SupplierDto> = emptyList(),
    val branches: List<BranchDto> = emptyList(),
    val categories: List<CategoryDto> = emptyList(),
    val imports: List<ImportRecordDto> = emptyList(),
    @SerialName("import_returns")
    val importReturns: List<ImportReturnDto> = emptyList(),
    val transfers: List<TransferDto> = emptyList()
)

@Serializable
data class DataViewResponse(
    val success: Boolean = false,
    val error: String? = null,
    val user: UserDto? = null,
    val data: StoreDataDto? = null,
    val revision: Long = 0L,
    val csrfToken: String? = null
)

// --- Media Upload DTOs ---

@Serializable
data class UploadMediaRequest(
    val data: String,
    val type: String = "image/jpeg"
)

@Serializable
data class UploadMediaResponse(
    val success: Boolean = false,
    val error: String? = null,
    val url: String? = null,
    val filename: String? = null,
    val size: Long = 0L,
    val mime: String? = null
)

// --- Command Envelopes & Payloads ---

@Serializable
data class GenericCommandEnvelope(
    val requestId: String,
    val revision: Long,
    val type: String,
    val payload: JsonElement
)

@Serializable
data class ImeiDetailPayload(
    val images: List<String> = emptyList(),
    val condition: String? = null,
    val conditionDetail: String = ""
)

@Serializable
data class ImportItemPayload(
    val code: String,
    val qty: Int,
    val price: Long,
    val hasImei: Boolean = false,
    val imeis: List<String> = emptyList(),
    val imeiDetails: Map<String, ImeiDetailPayload> = emptyMap(),
    val images: List<String> = emptyList(),
    val condition: String = "new",
    val conditionDetail: String = ""
)

@Serializable
data class ImportPayload(
    val branch: String,
    val supplierCode: String,
    val items: List<ImportItemPayload>,
    val paid: Long,
    val paymentMethod: String,
    val note: String = "",
    val copiedFrom: String = ""
)

@Serializable
data class ImportCommandEnvelope(
    val requestId: String,
    val revision: Long,
    val type: String = "import",
    val payload: ImportPayload
)

@Serializable
data class CancelImportPayload(
    val importId: String,
    val reason: String = "",
    val refundMethod: String = "cash"
)

@Serializable
data class ReturnImportItemPayload(
    val code: String,
    val qty: Int,
    val imeis: List<String> = emptyList()
)

@Serializable
data class ReturnImportPayload(
    val importId: String,
    val items: List<ReturnImportItemPayload>,
    val refundMethod: String = "cash",
    val reason: String = ""
)

@Serializable
data class ExchangeImportPayload(
    val importId: String,
    val returnItems: List<ReturnImportItemPayload>,
    val exchangeItems: List<ImportItemPayload>,
    val method: String = "transfer",
    val reason: String = ""
)

@Serializable
data class TablePatch<T>(
    val upsert: List<T> = emptyList(),
    val remove: List<String> = emptyList()
)

@Serializable
data class CommandResponse(
    val success: Boolean = false,
    val error: String? = null,
    val replayed: Boolean = false,
    val revision: Long = 0L,
    val data: StoreDataDto? = null,
    val result: JsonObject? = null
)

// --- Local Draft & UI Domain Models ---

@Serializable
enum class DeviceCondition(val apiValue: String, val label: String) {
    @SerialName("new")
    NEW("new", "Mới 100%"),

    @SerialName("like_new")
    LIKE_NEW("like_new", "Như mới (99%)"),

    @SerialName("good")
    GOOD("good", "Tốt (95%)"),

    @SerialName("fair")
    FAIR("fair", "Khá / Trầy xước");

    companion object {
        fun fromApi(value: String?): DeviceCondition? = entries.firstOrNull { it.apiValue == value }
    }
}

@Serializable
enum class PaymentMode(val label: String) {
    UNPAID("Chưa trả"),
    FULL("Trả đủ"),
    PARTIAL("Trả một phần")
}

@Serializable
enum class PaymentMethod(val apiValue: String, val label: String) {
    CASH("cash", "Tiền mặt"),
    TRANSFER("transfer", "Chuyển khoản"),
    CARD("card", "Thẻ");

    companion object {
        fun fromApi(value: String?): PaymentMethod = when (value) {
            "transfer", "bank", "Chuyển khoản" -> TRANSFER
            "card", "Thẻ" -> CARD
            else -> CASH
        }
    }
}

@Serializable
data class DraftPhoto(
    val localPath: String,
    val remoteUrl: String? = null
)

@Serializable
data class DraftImeiDetail(
    val condition: DeviceCondition? = null,
    val conditionDetail: String = "",
    val photos: List<DraftPhoto> = emptyList()
)

@Serializable
data class DraftItem(
    val productCode: String,
    val productName: String,
    val unit: String = "",
    val hasImei: Boolean = false,
    val qty: Int = 1,
    val unitPrice: Long = 0L,
    val imeis: List<String> = emptyList(),
    val imeiDetails: Map<String, DraftImeiDetail> = emptyMap(),
    val condition: DeviceCondition? = null,
    val conditionDetail: String = "",
    val photos: List<DraftPhoto> = emptyList()
) {
    val effectiveQty: Int
        get() = if (hasImei) imeis.size else qty

    val lineTotal: Long
        get() = effectiveQty.toLong() * unitPrice
}

@Serializable
data class DraftContent(
    val branchName: String = "",
    val supplierCode: String = "",
    val supplierName: String = "",
    val items: List<DraftItem> = emptyList(),
    val paymentMode: PaymentMode = PaymentMode.UNPAID,
    val partialPaidAmount: Long = 0L,
    val paymentMethod: PaymentMethod = PaymentMethod.CASH,
    val note: String = "",
    val copiedFrom: String = "",
    val pendingRequestId: String? = null,
    val pendingRevision: Long? = null
) {
    val totalAmount: Long
        get() = items.sumOf { it.lineTotal }

    val totalUnits: Int
        get() = items.sumOf { it.effectiveQty }

    val paidAmount: Long
        get() = when (paymentMode) {
            PaymentMode.UNPAID -> 0L
            PaymentMode.FULL -> totalAmount
            PaymentMode.PARTIAL -> partialPaidAmount.coerceIn(0L, totalAmount)
        }

    val remainingDebt: Long
        get() = (totalAmount - paidAmount).coerceAtLeast(0L)
}
