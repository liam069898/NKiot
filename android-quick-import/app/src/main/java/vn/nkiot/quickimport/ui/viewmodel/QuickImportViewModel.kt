package vn.nkiot.quickimport.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import vn.nkiot.quickimport.data.local.ImportDraftEntity
import vn.nkiot.quickimport.data.model.BranchDto
import vn.nkiot.quickimport.data.model.CategoryDto
import vn.nkiot.quickimport.data.model.DeviceCondition
import vn.nkiot.quickimport.data.model.DraftContent
import vn.nkiot.quickimport.data.model.DraftImeiDetail
import vn.nkiot.quickimport.data.model.DraftItem
import vn.nkiot.quickimport.data.model.DraftPhoto
import vn.nkiot.quickimport.data.model.ImportItemPayload
import vn.nkiot.quickimport.data.model.ImportRecordDto
import vn.nkiot.quickimport.data.model.ImportReturnDto
import vn.nkiot.quickimport.data.model.PaymentMethod
import vn.nkiot.quickimport.data.model.PaymentMode
import vn.nkiot.quickimport.data.model.ProductDto
import vn.nkiot.quickimport.data.model.ReturnImportItemPayload
import vn.nkiot.quickimport.data.model.StoreDataDto
import vn.nkiot.quickimport.data.model.SupplierDto
import vn.nkiot.quickimport.data.model.UserDto
import vn.nkiot.quickimport.data.remote.ApiException
import vn.nkiot.quickimport.data.repository.QuickImportRepository
import vn.nkiot.quickimport.data.repository.SubmitResult
import java.util.UUID

data class QuickImportUiState(
    val isLoggedIn: Boolean = false,
    val serverUrl: String = "",
    val savedUsername: String = "",
    val currentUser: UserDto? = null,
    val isBusy: Boolean = false,
    val isSyncing: Boolean = false,
    val isSubmitting: Boolean = false,
    val revision: Long = 0L,
    val products: List<ProductDto> = emptyList(),
    val suppliers: List<SupplierDto> = emptyList(),
    val branches: List<BranchDto> = emptyList(),
    val categories: List<CategoryDto> = emptyList(),
    val imports: List<ImportRecordDto> = emptyList(),
    val importReturns: List<ImportReturnDto> = emptyList(),
    val systemImeis: Set<String> = emptySet(),
    val activeDraftId: String? = null,
    val draft: DraftContent = DraftContent(),
    val bannerMessage: String? = null,
    val errorMessage: String? = null,
    val lastSuccessCode: String? = null
)

data class ImportReturnSummary(
    val returnedQtyByCode: Map<String, Int> = emptyMap(),
    val returnedSerials: Set<String> = emptySet(),
    val returnRecords: List<ImportReturnDto> = emptyList(),
    val totalReturnedQty: Int = 0
)

sealed interface ScanSkuOutcome {
    data class AddedNormalProduct(val product: ProductDto) : ScanSkuOutcome
    data class OpenImeiScanner(val product: ProductDto) : ScanSkuOutcome
    data class NotFound(val rawCode: String) : ScanSkuOutcome
}

sealed interface ScanImeiOutcome {
    data class Added(val imei: String, val totalForProduct: Int) : ScanImeiOutcome
    data class DuplicateInDraft(val imei: String) : ScanImeiOutcome
    data class ExistsInSystem(val imei: String) : ScanImeiOutcome
    data class Invalid(val message: String) : ScanImeiOutcome
}

data class BulkImeiResult(
    val addedCount: Int,
    val duplicateInDraft: Int,
    val existsInSystem: Int
)

class QuickImportViewModel(
    private val repository: QuickImportRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        QuickImportUiState(
            isLoggedIn = repository.isLoggedIn,
            serverUrl = repository.savedServerUrl,
            savedUsername = repository.savedUsername
        )
    )
    val uiState: StateFlow<QuickImportUiState> = _uiState.asStateFlow()

    val drafts: StateFlow<List<ImportDraftEntity>> = repository.draftsFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        repository.loadCachedCatalog()?.let { (cachedData, rev) ->
            applyCatalog(cachedData, rev, user = null)
        }
        if (repository.isLoggedIn) {
            refreshCatalog(silent = true)
        }
    }

    fun resolveMediaUrl(url: String): String = repository.resolveMediaUrl(url)

    fun currentCookieHeader(): String? = repository.currentCookieHeader()

    private fun applyCatalog(data: StoreDataDto?, revision: Long, user: UserDto?) {
        if (data == null) return
        val existingImeis = buildSet {
            data.products.forEach { p -> addAll(p.imeis) }
            data.transfers.filter { it.status == "shipping" }.forEach { t ->
                t.items.forEach { item -> addAll(item.imeis) }
            }
        }
        _uiState.update { state ->
            state.copy(
                currentUser = user ?: state.currentUser,
                revision = if (revision > 0) revision else state.revision,
                products = data.products.filter { it.status != "inactive" && it.status != "archived" },
                suppliers = data.suppliers,
                branches = data.branches,
                categories = data.categories,
                imports = data.imports,
                importReturns = data.importReturns,
                systemImeis = existingImeis
            )
        }
    }

    fun returnSummaryFor(importCode: String): ImportReturnSummary {
        val records = _uiState.value.importReturns.filter { it.importCode == importCode }
        if (records.isEmpty()) return ImportReturnSummary()
        val qtyMap = mutableMapOf<String, Int>()
        val serials = mutableSetOf<String>()
        var totalQty = 0
        for (rec in records) {
            for (row in rec.items) {
                qtyMap[row.code] = (qtyMap[row.code] ?: 0) + row.qty
                totalQty += row.qty
                serials.addAll(row.imeis)
            }
        }
        return ImportReturnSummary(
            returnedQtyByCode = qtyMap,
            returnedSerials = serials,
            returnRecords = records,
            totalReturnedQty = totalQty
        )
    }

    fun currentBranchProduct(code: String, branchName: String): ProductDto? {
        return _uiState.value.products.firstOrNull {
            it.code == code && (it.branch.equals(branchName, ignoreCase = true) || branchName.isBlank())
        } ?: _uiState.value.products.firstOrNull { it.code == code }
    }

    fun clearMessages() {
        _uiState.update { it.copy(bannerMessage = null, errorMessage = null, lastSuccessCode = null) }
    }

    fun login(serverUrl: String, username: String, password: String) {
        if (serverUrl.isBlank() || username.isBlank() || password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Vui lòng nhập đầy đủ địa chỉ máy chủ, tài khoản và mật khẩu.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isBusy = true, errorMessage = null) }
            try {
                val res = repository.login(serverUrl, username, password)
                applyCatalog(res.data, res.revision, res.user)
                _uiState.update {
                    it.copy(
                        isLoggedIn = true,
                        isBusy = false,
                        serverUrl = repository.savedServerUrl,
                        savedUsername = repository.savedUsername,
                        bannerMessage = "Đã kết nối NKiot (${res.user?.name ?: username})"
                    )
                }
            } catch (e: ApiException) {
                _uiState.update { it.copy(isBusy = false, errorMessage = e.message) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isBusy = false, errorMessage = e.message ?: "Đăng nhập thất bại.") }
            }
        }
    }

    fun refreshCatalog(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(isSyncing = true, errorMessage = null) }
            try {
                val res = repository.refreshCatalog()
                applyCatalog(res.data, res.revision, res.user)
                _uiState.update {
                    it.copy(
                        isSyncing = false,
                        bannerMessage = if (!silent) "Đã đồng bộ dữ liệu mới nhất (rev ${res.revision})" else it.bannerMessage
                    )
                }
            } catch (e: ApiException) {
                if (e.statusCode == 401) {
                    _uiState.update { it.copy(isSyncing = false, isLoggedIn = false, errorMessage = e.message) }
                } else if (!silent) {
                    _uiState.update { it.copy(isSyncing = false, errorMessage = e.message) }
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            _uiState.update {
                it.copy(
                    isLoggedIn = false,
                    currentUser = null,
                    activeDraftId = null,
                    draft = DraftContent()
                )
            }
        }
    }

    // --- Draft Management ---

    fun createNewDraft(): String {
        val id = UUID.randomUUID().toString()
        val defaultBranch = _uiState.value.let { st ->
            st.branches.firstOrNull { it.isDefault }?.name
                ?: st.currentUser?.branch?.takeIf { it.isNotBlank() && it != "Toàn bộ chi nhánh" }
                ?: st.branches.firstOrNull()?.name
                ?: ""
        }
        val fresh = DraftContent(branchName = defaultBranch)
        _uiState.update { it.copy(activeDraftId = id, draft = fresh, errorMessage = null, lastSuccessCode = null) }
        persistDraft(id, fresh)
        return id
    }

    fun copyImportToNewDraft(imp: ImportRecordDto): String {
        val id = UUID.randomUUID().toString()
        val items = imp.items.map { row ->
            val currentProd = currentBranchProduct(row.code, imp.branch)
            val isImei = row.hasImei || currentProd?.hasImei == true
            DraftItem(
                productCode = row.code,
                productName = row.name.ifBlank { currentProd?.name ?: row.code },
                unit = currentProd?.unit ?: "",
                hasImei = isImei,
                qty = if (isImei) 0 else row.qty.coerceAtLeast(1),
                unitPrice = row.price,
                imeis = emptyList()
            )
        }
        val draft = DraftContent(
            branchName = imp.branch,
            supplierCode = imp.nccCode,
            supplierName = imp.nccName,
            items = items,
            paymentMode = PaymentMode.UNPAID,
            paymentMethod = PaymentMethod.fromApi(imp.paymentMethod),
            note = imp.note,
            copiedFrom = imp.code
        )
        _uiState.update {
            it.copy(
                activeDraftId = id,
                draft = draft,
                errorMessage = null,
                bannerMessage = "Đã sao chép từ phiếu ${imp.code}. Với hàng IMEI, hãy quét lại serial mới."
            )
        }
        persistDraft(id, draft)
        return id
    }

    fun openDraft(draftId: String, onLoaded: () -> Unit = {}) {
        viewModelScope.launch {
            val loaded = repository.loadDraft(draftId)
            if (loaded != null) {
                _uiState.update {
                    it.copy(
                        activeDraftId = draftId,
                        draft = loaded,
                        errorMessage = null,
                        lastSuccessCode = null
                    )
                }
                onLoaded()
            }
        }
    }

    fun deleteDraft(draftId: String) {
        viewModelScope.launch {
            repository.deleteDraft(draftId)
            if (_uiState.value.activeDraftId == draftId) {
                _uiState.update { it.copy(activeDraftId = null, draft = DraftContent()) }
            }
        }
    }

    private fun updateDraft(transform: (DraftContent) -> DraftContent) {
        val draftId = _uiState.value.activeDraftId ?: return
        val current = _uiState.value.draft
        if (!current.pendingRequestId.isNullOrBlank()) {
            _uiState.update {
                it.copy(errorMessage = "Phiếu đang chờ kiểm tra kết quả gửi. Bấm 'Kiểm tra kết quả' trước khi chỉnh sửa.")
            }
            return
        }
        val updated = transform(current)
        _uiState.update { it.copy(draft = updated) }
        persistDraft(draftId, updated)
    }

    private fun persistDraft(draftId: String, content: DraftContent) {
        viewModelScope.launch {
            repository.saveDraft(draftId, content)
        }
    }

    // --- Header Fields ---

    fun selectBranch(branchName: String) {
        updateDraft { it.copy(branchName = branchName) }
    }

    fun selectSupplier(supplier: SupplierDto) {
        updateDraft { it.copy(supplierCode = supplier.code, supplierName = supplier.name) }
    }

    fun updateNote(note: String) {
        updateDraft { it.copy(note = note) }
    }

    fun selectPaymentMode(mode: PaymentMode) {
        updateDraft { draft ->
            val partial = if (mode == PaymentMode.PARTIAL && draft.partialPaidAmount == 0L) {
                draft.totalAmount / 2
            } else {
                draft.partialPaidAmount
            }
            draft.copy(paymentMode = mode, partialPaidAmount = partial)
        }
    }

    fun updatePartialPaid(amount: Long) {
        updateDraft { it.copy(partialPaidAmount = amount.coerceAtLeast(0L)) }
    }

    fun selectPaymentMethod(method: PaymentMethod) {
        updateDraft { it.copy(paymentMethod = method) }
    }

    // --- Products & Barcode Scanning ---

    fun productsForSelectedBranch(): List<ProductDto> {
        return productsForBranch(_uiState.value.draft.branchName)
    }

    fun productsForBranch(branch: String): List<ProductDto> {
        val all = _uiState.value.products
        if (branch.isBlank()) return all
        val filtered = all.filter { it.branch.equals(branch, ignoreCase = true) || it.branch.isBlank() }
        return filtered.ifEmpty { all }
    }

    fun addProductToDraft(product: ProductDto) {
        updateDraft { draft ->
            val idx = draft.items.indexOfFirst { it.productCode == product.code }
            if (idx >= 0) {
                val existing = draft.items[idx]
                if (existing.hasImei) {
                    draft
                } else {
                    val updatedList = draft.items.toMutableList()
                    updatedList[idx] = existing.copy(qty = existing.qty + 1)
                    draft.copy(items = updatedList)
                }
            } else {
                val newItem = DraftItem(
                    productCode = product.code,
                    productName = product.name,
                    unit = product.unit,
                    hasImei = product.hasImei,
                    qty = if (product.hasImei) 0 else 1,
                    unitPrice = product.costPrice
                )
                draft.copy(items = listOf(newItem) + draft.items)
            }
        }
    }

    fun handleScannedSku(rawCode: String): ScanSkuOutcome {
        val cleaned = rawCode.trim()
        if (cleaned.isEmpty()) return ScanSkuOutcome.NotFound(rawCode)
        val candidates = productsForSelectedBranch()
        val match = candidates.firstOrNull {
            it.barcode.equals(cleaned, ignoreCase = true) ||
                it.code.equals(cleaned, ignoreCase = true)
        } ?: return ScanSkuOutcome.NotFound(cleaned)

        addProductToDraft(match)
        return if (match.hasImei) {
            ScanSkuOutcome.OpenImeiScanner(match)
        } else {
            ScanSkuOutcome.AddedNormalProduct(match)
        }
    }

    fun updateItemQty(productCode: String, newQty: Int) {
        updateDraft { draft ->
            val updated = draft.items.mapNotNull { item ->
                if (item.productCode != productCode) {
                    item
                } else if (item.hasImei) {
                    item
                } else if (newQty <= 0) {
                    null
                } else {
                    item.copy(qty = newQty)
                }
            }
            draft.copy(items = updated)
        }
    }

    fun updateItemPrice(productCode: String, newPrice: Long) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) item.copy(unitPrice = newPrice.coerceAtLeast(0L))
                else item
            }
            draft.copy(items = updated)
        }
    }

    fun removeItem(productCode: String) {
        updateDraft { draft ->
            draft.copy(items = draft.items.filterNot { it.productCode == productCode })
        }
    }

    // --- Non-IMEI Product Condition & Photos ---

    fun updateProductInspection(
        productCode: String,
        condition: DeviceCondition?,
        conditionDetail: String
    ) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    item.copy(condition = condition, conditionDetail = conditionDetail)
                } else item
            }
            draft.copy(items = updated)
        }
    }

    fun addPhotoToProduct(productCode: String, localPath: String) {
        addPhotosToProduct(productCode, listOf(localPath))
    }

    fun addPhotosToProduct(productCode: String, localPaths: List<String>) {
        if (localPaths.isEmpty()) return
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val newPhotos = localPaths.map { DraftPhoto(localPath = it) }
                    item.copy(photos = item.photos + newPhotos)
                } else item
            }
            draft.copy(items = updated)
        }
    }

    fun removePhotoFromProduct(productCode: String, localPath: String) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    item.copy(photos = item.photos.filterNot { it.localPath == localPath })
                } else item
            }
            draft.copy(items = updated)
        }
    }

    // --- IMEI Continuous Scanning, Bulk Paste & Inspection ---

    fun addImeiToProduct(productCode: String, rawImei: String): ScanImeiOutcome {
        val imei = rawImei.trim()
        if (imei.isEmpty() || imei.length > 200) {
            return ScanImeiOutcome.Invalid("Mã IMEI/Serial không hợp lệ.")
        }
        val state = _uiState.value
        if (state.systemImeis.contains(imei)) {
            return ScanImeiOutcome.ExistsInSystem(imei)
        }
        val alreadyInDraft = state.draft.items.any { item -> item.imeis.contains(imei) }
        if (alreadyInDraft) {
            return ScanImeiOutcome.DuplicateInDraft(imei)
        }

        var countAfter = 0
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val nextImeis = item.imeis + imei
                    countAfter = nextImeis.size
                    item.copy(hasImei = true, imeis = nextImeis, qty = nextImeis.size)
                } else {
                    item
                }
            }
            draft.copy(items = updated)
        }
        return ScanImeiOutcome.Added(imei, countAfter)
    }

    fun addBulkImeisToProduct(productCode: String, rawText: String): BulkImeiResult {
        val candidates = QuickImportRepository.parseBulkImeis(rawText)
        val state = _uiState.value
        val existingInDraft = state.draft.items.flatMap { it.imeis }.toMutableSet()
        val toAdd = mutableListOf<String>()
        var dupDraft = 0
        var inSys = 0

        for (imei in candidates) {
            if (imei.length > 200) continue
            if (state.systemImeis.contains(imei)) {
                inSys++
            } else if (!existingInDraft.add(imei)) {
                dupDraft++
            } else {
                toAdd += imei
            }
        }

        if (toAdd.isNotEmpty()) {
            updateDraft { draft ->
                val updated = draft.items.map { item ->
                    if (item.productCode == productCode) {
                        val nextImeis = item.imeis + toAdd
                        item.copy(hasImei = true, imeis = nextImeis, qty = nextImeis.size)
                    } else item
                }
                draft.copy(items = updated)
            }
        }
        return BulkImeiResult(addedCount = toAdd.size, duplicateInDraft = dupDraft, existsInSystem = inSys)
    }

    fun removeImei(productCode: String, imei: String) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val nextImeis = item.imeis.filterNot { it == imei }
                    val nextDetails = item.imeiDetails - imei
                    item.copy(imeis = nextImeis, imeiDetails = nextDetails, qty = nextImeis.size)
                } else {
                    item
                }
            }
            draft.copy(items = updated)
        }
    }

    fun updateImeiInspection(
        productCode: String,
        imei: String,
        condition: DeviceCondition?,
        conditionDetail: String
    ) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val current = item.imeiDetails[imei] ?: DraftImeiDetail()
                    val nextDetail = current.copy(condition = condition, conditionDetail = conditionDetail)
                    item.copy(imeiDetails = item.imeiDetails + (imei to nextDetail))
                } else {
                    item
                }
            }
            draft.copy(items = updated)
        }
    }

    fun addPhotoToImei(productCode: String, imei: String, localPath: String) {
        addPhotosToImei(productCode, imei, listOf(localPath))
    }

    fun addPhotosToImei(productCode: String, imei: String, localPaths: List<String>) {
        if (localPaths.isEmpty()) return
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val current = item.imeiDetails[imei] ?: DraftImeiDetail()
                    val newPhotos = localPaths.map { DraftPhoto(localPath = it) }
                    val nextPhotos = current.photos + newPhotos
                    item.copy(imeiDetails = item.imeiDetails + (imei to current.copy(photos = nextPhotos)))
                } else {
                    item
                }
            }
            draft.copy(items = updated)
        }
    }

    fun removePhotoFromImei(productCode: String, imei: String, localPath: String) {
        updateDraft { draft ->
            val updated = draft.items.map { item ->
                if (item.productCode == productCode) {
                    val current = item.imeiDetails[imei] ?: DraftImeiDetail()
                    val nextPhotos = current.photos.filterNot { it.localPath == localPath }
                    item.copy(imeiDetails = item.imeiDetails + (imei to current.copy(photos = nextPhotos)))
                } else {
                    item
                }
            }
            draft.copy(items = updated)
        }
    }

    // --- Quick-Add Supplier & Product (CatalogPatch) ---

    fun createQuickSupplier(
        name: String,
        phone: String,
        address: String,
        onCreated: (SupplierDto) -> Unit
    ) {
        val cleanName = name.trim()
        if (cleanName.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Vui lòng nhập tên nhà cung cấp.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            val state = _uiState.value
            val code = QuickImportRepository.generateNextCode(
                state.suppliers.map { it.code },
                prefix = "NCC",
                minPad = 6
            )
            val newSup = SupplierDto(
                id = code,
                code = code,
                name = cleanName,
                phone = phone.trim(),
                address = address.trim(),
                debt = 0L,
                totalBought = 0L
            )
            when (val res = repository.createSupplier(newSup, state.revision)) {
                is SubmitResult.Success -> {
                    applyCatalog(res.response.data, res.response.revision, user = null)
                    selectSupplier(newSup)
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            bannerMessage = "Đã tạo nhà cung cấp $cleanName ($code)"
                        )
                    }
                    onCreated(newSup)
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    fun createQuickProduct(
        name: String,
        customCode: String,
        barcode: String,
        category: String,
        unit: String,
        costPrice: Long,
        sellPrice: Long,
        hasImei: Boolean,
        onCreated: (ProductDto) -> Unit
    ) {
        val cleanName = name.trim()
        if (cleanName.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Vui lòng nhập tên sản phẩm.") }
            return
        }
        val state = _uiState.value
        val branchName = state.draft.branchName.ifBlank {
            state.branches.firstOrNull { it.isDefault }?.name
                ?: state.branches.firstOrNull()?.name
                ?: ""
        }
        if (branchName.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Vui lòng chọn kho nhận trước khi thêm sản phẩm.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            val code = customCode.trim().ifEmpty {
                QuickImportRepository.generateNextCode(
                    state.products.map { it.code },
                    prefix = "SP",
                    minPad = 3
                )
            }
            val newProd = ProductDto(
                id = "${code}_${UUID.randomUUID().toString().take(6)}",
                code = code,
                name = cleanName,
                category = category.trim().ifEmpty { state.categories.firstOrNull()?.name ?: "Khác" },
                costPrice = costPrice.coerceAtLeast(0L),
                price = sellPrice.coerceAtLeast(0L),
                stock = 0,
                minStock = 0,
                unit = unit.trim().ifEmpty { "Chiếc" },
                status = "active",
                barcode = barcode.trim(),
                branch = branchName,
                hasImei = hasImei,
                imeis = emptyList(),
                images = emptyList()
            )
            when (val res = repository.createProduct(newProd, state.revision)) {
                is SubmitResult.Success -> {
                    applyCatalog(res.response.data, res.response.revision, user = null)
                    addProductToDraft(newProd)
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            bannerMessage = "Đã tạo & thêm sản phẩm $cleanName ($code)"
                        )
                    }
                    onCreated(newProd)
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    // --- Submit Import & Recovery ---

    fun submitActiveDraft(onSuccess: (String) -> Unit) {
        val draftId = _uiState.value.activeDraftId ?: return
        val draft = _uiState.value.draft
        val revision = _uiState.value.revision

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null, bannerMessage = null) }
            val result = repository.submitDraft(
                draftId = draftId,
                content = draft,
                currentRevision = revision,
                onDraftUpdated = { updated -> _uiState.update { it.copy(draft = updated) } }
            )
            when (result) {
                is SubmitResult.Success -> {
                    applyCatalog(result.response.data, result.response.revision, user = null)
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            activeDraftId = null,
                            draft = DraftContent(),
                            lastSuccessCode = result.code,
                            bannerMessage = "Nhập hàng thành công: ${result.code}"
                        )
                    }
                    onSuccess(result.code)
                }
                is SubmitResult.UncertainNetwork -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = result.message) }
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            errorMessage = "${result.message} Đang tải lại dữ liệu mới nhất..."
                        )
                    }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = result.message) }
                }
            }
        }
    }

    fun verifyPendingDraft(onSuccess: (String) -> Unit) {
        val draftId = _uiState.value.activeDraftId ?: return
        val pendingId = _uiState.value.draft.pendingRequestId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            when (val result = repository.verifyPendingRequest(draftId, pendingId)) {
                is SubmitResult.Success -> {
                    applyCatalog(result.response.data, result.response.revision, user = null)
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            activeDraftId = null,
                            draft = DraftContent(),
                            lastSuccessCode = result.code,
                            bannerMessage = "Đã xác nhận phiếu nhập thành công: ${result.code}"
                        )
                    }
                    onSuccess(result.code)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = result.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    fun unlockPendingDraft() {
        val draftId = _uiState.value.activeDraftId ?: return
        val unlocked = _uiState.value.draft.copy(pendingRequestId = null, pendingRevision = null)
        _uiState.update { it.copy(draft = unlocked, errorMessage = null) }
        persistDraft(draftId, unlocked)
    }

    // --- Cancel, Return, Exchange Import ---

    fun cancelImport(
        importId: String,
        reason: String,
        refundMethod: PaymentMethod,
        onDone: () -> Unit
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            when (val res = repository.cancelImport(importId, reason, refundMethod.apiValue, _uiState.value.revision)) {
                is SubmitResult.Success -> {
                    applyCatalog(res.response.data, res.response.revision, user = null)
                    _uiState.update {
                        it.copy(isSubmitting = false, bannerMessage = "Đã hủy phiếu nhập $importId")
                    }
                    onDone()
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    fun returnImport(
        importId: String,
        items: List<ReturnImportItemPayload>,
        refundMethod: PaymentMethod,
        reason: String,
        onDone: (String) -> Unit
    ) {
        if (items.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Chọn ít nhất một sản phẩm để trả nhà cung cấp.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            when (val res = repository.returnImport(importId, items, refundMethod.apiValue, reason, _uiState.value.revision)) {
                is SubmitResult.Success -> {
                    applyCatalog(res.response.data, res.response.revision, user = null)
                    _uiState.update {
                        it.copy(isSubmitting = false, bannerMessage = "Đã tạo phiếu trả hàng NCC: ${res.code}")
                    }
                    onDone(res.code)
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    fun exchangeImport(
        importId: String,
        returnItems: List<ReturnImportItemPayload>,
        exchangeItems: List<ImportItemPayload>,
        method: PaymentMethod,
        reason: String,
        onDone: (String) -> Unit
    ) {
        if (returnItems.isEmpty() || exchangeItems.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Cần chọn đủ hàng trả lại NCC và hàng NCC đổi lại.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            when (val res = repository.exchangeImport(importId, returnItems, exchangeItems, method.apiValue, reason, _uiState.value.revision)) {
                is SubmitResult.Success -> {
                    applyCatalog(res.response.data, res.response.revision, user = null)
                    _uiState.update {
                        it.copy(isSubmitting = false, bannerMessage = "Đã tạo phiếu đổi hàng NCC: ${res.code}")
                    }
                    onDone(res.code)
                }
                is SubmitResult.RevisionConflict -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                    refreshCatalog(silent = false)
                }
                is SubmitResult.Error -> {
                    _uiState.update { it.copy(isSubmitting = false, errorMessage = res.message) }
                }
                else -> _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }

    class Factory(private val repository: QuickImportRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return QuickImportViewModel(repository) as T
        }
    }
}
