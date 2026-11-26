package vn.nkiot.quickimport

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import vn.nkiot.quickimport.data.model.DraftImeiDetail
import vn.nkiot.quickimport.ui.screens.BulkImeiPasteDialog
import vn.nkiot.quickimport.ui.screens.DraftsScreen
import vn.nkiot.quickimport.ui.screens.FullscreenImageViewer
import vn.nkiot.quickimport.ui.screens.ImeiInspectionSheet
import vn.nkiot.quickimport.ui.screens.ImportDetailScreen
import vn.nkiot.quickimport.ui.screens.LoginScreen
import vn.nkiot.quickimport.ui.screens.QuickAddProductSheet
import vn.nkiot.quickimport.ui.screens.QuickAddSupplierSheet
import vn.nkiot.quickimport.ui.screens.QuickImportScreen
import vn.nkiot.quickimport.ui.screens.ScanFeedback
import vn.nkiot.quickimport.ui.screens.ScannerMode
import vn.nkiot.quickimport.ui.screens.ScannerScreen
import vn.nkiot.quickimport.ui.theme.NkiotQuickImportTheme
import vn.nkiot.quickimport.ui.viewmodel.QuickImportViewModel
import vn.nkiot.quickimport.ui.viewmodel.ScanImeiOutcome
import vn.nkiot.quickimport.ui.viewmodel.ScanSkuOutcome

private sealed interface ActiveScreen {
    data object Home : ActiveScreen
    data object Editor : ActiveScreen
    data class ImportDetail(val importCode: String) : ActiveScreen
    data object SkuScanner : ActiveScreen
    data class ImeiScanner(val productCode: String) : ActiveScreen
}

private sealed interface InspectionTarget {
    data class Imei(val productCode: String, val productName: String, val imei: String) : InspectionTarget
    data class NormalProduct(val productCode: String, val productName: String) : InspectionTarget
}

private data class BulkPasteTarget(
    val productCode: String,
    val productName: String
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as NkiotQuickImportApp
        setContent {
            NkiotQuickImportTheme {
                val vm: QuickImportViewModel = viewModel(
                    factory = QuickImportViewModel.Factory(app.repository)
                )
                NkiotRoot(vm)
            }
        }
    }
}

@Composable
private fun NkiotRoot(vm: QuickImportViewModel) {
    val uiState by vm.uiState.collectAsState()
    val drafts by vm.drafts.collectAsState()

    var screen by remember { mutableStateOf<ActiveScreen>(ActiveScreen.Home) }
    var inspectionTarget by remember { mutableStateOf<InspectionTarget?>(null) }
    var bulkPasteTarget by remember { mutableStateOf<BulkPasteTarget?>(null) }
    var showAddSupplier by remember { mutableStateOf(false) }
    var showAddProduct by remember { mutableStateOf(false) }

    if (!uiState.isLoggedIn) {
        LoginScreen(
            initialServerUrl = uiState.serverUrl,
            initialUsername = uiState.savedUsername,
            isBusy = uiState.isBusy,
            errorMessage = uiState.errorMessage,
            onLogin = { url, user, pass ->
                vm.login(url, user, pass)
                screen = ActiveScreen.Home
            }
        )
        return
    }

    BackHandler(enabled = screen != ActiveScreen.Home) {
        when (screen) {
            is ActiveScreen.SkuScanner -> screen = ActiveScreen.Editor
            is ActiveScreen.ImeiScanner -> screen = ActiveScreen.Editor
            is ActiveScreen.Editor -> screen = ActiveScreen.Home
            is ActiveScreen.ImportDetail -> screen = ActiveScreen.Home
            ActiveScreen.Home -> Unit
        }
    }

    when (val current = screen) {
        is ActiveScreen.Home -> {
            DraftsScreen(
                uiState = uiState,
                drafts = drafts,
                returnSummaryLookup = vm::returnSummaryFor,
                onCreateDraft = {
                    vm.createNewDraft()
                    screen = ActiveScreen.Editor
                },
                onOpenDraft = { id ->
                    vm.openDraft(id) {
                        screen = ActiveScreen.Editor
                    }
                },
                onDeleteDraft = { vm.deleteDraft(it) },
                onOpenImportDetail = { code ->
                    vm.clearMessages()
                    screen = ActiveScreen.ImportDetail(code)
                },
                onRefresh = { vm.refreshCatalog(silent = false) },
                onLogout = { vm.logout() }
            )
        }

        is ActiveScreen.ImportDetail -> {
            val imp = uiState.imports.firstOrNull { it.code == current.importCode || it.id == current.importCode }
            if (imp == null) {
                screen = ActiveScreen.Home
            } else {
                ImportDetailScreen(
                    imp = imp,
                    returnSummary = vm.returnSummaryFor(imp.code),
                    branchProducts = vm.productsForBranch(imp.branch),
                    isSubmitting = uiState.isSubmitting,
                    errorMessage = uiState.errorMessage,
                    bannerMessage = uiState.bannerMessage,
                    resolveMediaUrl = vm::resolveMediaUrl,
                    cookieHeader = vm.currentCookieHeader(),
                    productLookup = { code -> vm.currentBranchProduct(code, imp.branch) },
                    onBack = { screen = ActiveScreen.Home },
                    onCopyImport = {
                        vm.copyImportToNewDraft(imp)
                        screen = ActiveScreen.Editor
                    },
                    onCancelImport = { reason, method ->
                        vm.cancelImport(imp.code, reason, method) {}
                    },
                    onReturnImport = { items, method, reason ->
                        vm.returnImport(imp.code, items, method, reason) {}
                    },
                    onExchangeImport = { retItems, exItems, method, reason ->
                        vm.exchangeImport(imp.code, retItems, exItems, method, reason) {}
                    }
                )
            }
        }

        is ActiveScreen.Editor -> {
            QuickImportScreen(
                uiState = uiState,
                branchProducts = vm.productsForSelectedBranch(),
                onBack = { screen = ActiveScreen.Home },
                onRefreshCatalog = { vm.refreshCatalog(silent = false) },
                onSelectBranch = vm::selectBranch,
                onSelectSupplier = vm::selectSupplier,
                onOpenQuickAddSupplier = { showAddSupplier = true },
                onOpenQuickAddProduct = { showAddProduct = true },
                onOpenSkuScanner = { screen = ActiveScreen.SkuScanner },
                onOpenImeiScanner = { code -> screen = ActiveScreen.ImeiScanner(code) },
                onOpenBulkPasteImei = { code, name -> bulkPasteTarget = BulkPasteTarget(code, name) },
                onAddProduct = vm::addProductToDraft,
                onUpdateQty = vm::updateItemQty,
                onUpdatePrice = vm::updateItemPrice,
                onRemoveItem = vm::removeItem,
                onRemoveImei = vm::removeImei,
                onInspectImei = { code, name, imei ->
                    inspectionTarget = InspectionTarget.Imei(code, name, imei)
                },
                onInspectNormalProduct = { code, name ->
                    inspectionTarget = InspectionTarget.NormalProduct(code, name)
                },
                onSelectPaymentMode = vm::selectPaymentMode,
                onUpdatePartialPaid = vm::updatePartialPaid,
                onSelectPaymentMethod = vm::selectPaymentMethod,
                onUpdateNote = vm::updateNote,
                onSubmit = {
                    vm.submitActiveDraft { createdCode ->
                        screen = ActiveScreen.ImportDetail(createdCode)
                    }
                },
                onVerifyPending = {
                    vm.verifyPendingDraft { verifiedCode ->
                        screen = ActiveScreen.ImportDetail(verifiedCode)
                    }
                },
                onUnlockPending = vm::unlockPendingDraft
            )
        }

        is ActiveScreen.SkuScanner -> {
            ScannerScreen(
                mode = ScannerMode.SKU,
                title = "Quét mã vạch sản phẩm",
                onCodeDetected = { raw ->
                    when (val outcome = vm.handleScannedSku(raw)) {
                        is ScanSkuOutcome.AddedNormalProduct -> {
                            screen = ActiveScreen.Editor
                            ScanFeedback("Đã thêm: ${outcome.product.name}", isSuccess = true)
                        }
                        is ScanSkuOutcome.OpenImeiScanner -> {
                            screen = ActiveScreen.ImeiScanner(outcome.product.code)
                            ScanFeedback("Mở quét IMEI: ${outcome.product.name}", isSuccess = true)
                        }
                        is ScanSkuOutcome.NotFound -> {
                            ScanFeedback("Không tìm thấy mã '$raw' trong kho", isSuccess = false)
                        }
                    }
                },
                onClose = { screen = ActiveScreen.Editor }
            )
        }

        is ActiveScreen.ImeiScanner -> {
            val item = uiState.draft.items.firstOrNull { it.productCode == current.productCode }
            ScannerScreen(
                mode = ScannerMode.IMEI_CONTINUOUS,
                title = item?.productName ?: current.productCode,
                scannedImeis = item?.imeis.orEmpty(),
                onRemoveImei = { imei -> vm.removeImei(current.productCode, imei) },
                onCodeDetected = { raw ->
                    when (val outcome = vm.addImeiToProduct(current.productCode, raw)) {
                        is ScanImeiOutcome.Added -> ScanFeedback(
                            "Đã thêm ${outcome.imei} (Tổng: ${outcome.totalForProduct})",
                            isSuccess = true
                        )
                        is ScanImeiOutcome.DuplicateInDraft -> ScanFeedback(
                            "Trùng IMEI ${outcome.imei} trong phiếu",
                            isSuccess = false,
                            isWarning = true
                        )
                        is ScanImeiOutcome.ExistsInSystem -> ScanFeedback(
                            "IMEI ${outcome.imei} đã tồn tại trong kho NKiot",
                            isSuccess = false
                        )
                        is ScanImeiOutcome.Invalid -> ScanFeedback(
                            outcome.message,
                            isSuccess = false
                        )
                    }
                },
                onClose = { screen = ActiveScreen.Editor }
            )
        }
    }

    when (val target = inspectionTarget) {
        is InspectionTarget.Imei -> {
            val item = uiState.draft.items.firstOrNull { it.productCode == target.productCode }
            val detail = item?.imeiDetails?.get(target.imei) ?: DraftImeiDetail()
            ImeiInspectionSheet(
                productName = target.productName,
                imei = target.imei,
                initialDetail = detail,
                onDetailChanged = { condition, description ->
                    vm.updateImeiInspection(target.productCode, target.imei, condition, description)
                },
                onPhotoAdded = { path ->
                    vm.addPhotoToImei(target.productCode, target.imei, path)
                },
                onPhotosAdded = { paths ->
                    vm.addPhotosToImei(target.productCode, target.imei, paths)
                },
                onPhotoRemoved = { path ->
                    vm.removePhotoFromImei(target.productCode, target.imei, path)
                },
                onDismiss = { inspectionTarget = null }
            )
        }
        is InspectionTarget.NormalProduct -> {
            val item = uiState.draft.items.firstOrNull { it.productCode == target.productCode }
            val detail = DraftImeiDetail(
                condition = item?.condition,
                conditionDetail = item?.conditionDetail.orEmpty(),
                photos = item?.photos.orEmpty()
            )
            ImeiInspectionSheet(
                productName = target.productName,
                imei = target.productCode,
                initialDetail = detail,
                isImeiProduct = false,
                onDetailChanged = { condition, description ->
                    vm.updateProductInspection(target.productCode, condition, description)
                },
                onPhotoAdded = { path ->
                    vm.addPhotoToProduct(target.productCode, path)
                },
                onPhotosAdded = { paths ->
                    vm.addPhotosToProduct(target.productCode, paths)
                },
                onPhotoRemoved = { path ->
                    vm.removePhotoFromProduct(target.productCode, path)
                },
                onDismiss = { inspectionTarget = null }
            )
        }
        null -> Unit
    }

    bulkPasteTarget?.let { target ->
        BulkImeiPasteDialog(
            productName = target.productName,
            onApply = { raw -> vm.addBulkImeisToProduct(target.productCode, raw) },
            onDismiss = { bulkPasteTarget = null }
        )
    }

    if (showAddSupplier) {
        QuickAddSupplierSheet(
            isSubmitting = uiState.isSubmitting,
            onCreate = { name, phone, address ->
                vm.createQuickSupplier(name, phone, address) {
                    showAddSupplier = false
                }
            },
            onDismiss = { showAddSupplier = false }
        )
    }

    if (showAddProduct) {
        QuickAddProductSheet(
            categories = uiState.categories,
            isSubmitting = uiState.isSubmitting,
            onCreate = { name, code, barcode, cat, unit, cost, sell, hasImei ->
                vm.createQuickProduct(name, code, barcode, cat, unit, cost, sell, hasImei) {
                    showAddProduct = false
                }
            },
            onDismiss = { showAddProduct = false }
        )
    }
}
