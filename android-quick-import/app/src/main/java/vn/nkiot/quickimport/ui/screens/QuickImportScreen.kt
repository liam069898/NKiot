package vn.nkiot.quickimport.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import java.io.File
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import vn.nkiot.quickimport.data.model.DraftImeiDetail
import vn.nkiot.quickimport.data.model.DraftItem
import vn.nkiot.quickimport.data.model.PaymentMethod
import vn.nkiot.quickimport.data.model.PaymentMode
import vn.nkiot.quickimport.data.model.ProductDto
import vn.nkiot.quickimport.data.model.SupplierDto
import vn.nkiot.quickimport.ui.theme.NkiotAmber
import vn.nkiot.quickimport.ui.theme.NkiotAmberBg
import vn.nkiot.quickimport.ui.theme.NkiotEmerald
import vn.nkiot.quickimport.ui.theme.NkiotEmeraldBg
import vn.nkiot.quickimport.ui.theme.NkiotRed
import vn.nkiot.quickimport.ui.util.formatVnd
import vn.nkiot.quickimport.ui.viewmodel.QuickImportUiState

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun QuickImportScreen(
    uiState: QuickImportUiState,
    branchProducts: List<ProductDto>,
    onBack: () -> Unit,
    onRefreshCatalog: () -> Unit,
    onSelectBranch: (String) -> Unit,
    onSelectSupplier: (SupplierDto) -> Unit,
    onOpenQuickAddSupplier: () -> Unit,
    onOpenQuickAddProduct: () -> Unit,
    onOpenSkuScanner: () -> Unit,
    onOpenImeiScanner: (productCode: String) -> Unit,
    onOpenBulkPasteImei: (productCode: String, productName: String) -> Unit,
    onAddProduct: (ProductDto) -> Unit,
    onUpdateQty: (productCode: String, qty: Int) -> Unit,
    onUpdatePrice: (productCode: String, price: Long) -> Unit,
    onRemoveItem: (productCode: String) -> Unit,
    onRemoveImei: (productCode: String, imei: String) -> Unit,
    onInspectImei: (productCode: String, productName: String, imei: String) -> Unit,
    onInspectNormalProduct: (productCode: String, productName: String) -> Unit,
    onSelectPaymentMode: (PaymentMode) -> Unit,
    onUpdatePartialPaid: (Long) -> Unit,
    onSelectPaymentMethod: (PaymentMethod) -> Unit,
    onUpdateNote: (String) -> Unit,
    onSubmit: () -> Unit,
    onVerifyPending: () -> Unit,
    onUnlockPending: () -> Unit
) {
    val draft = uiState.draft
    val isPending = !draft.pendingRequestId.isNullOrBlank()
    var showConfirmSubmit by remember { mutableStateOf(false) }

    var showBranchMenu by remember { mutableStateOf(false) }
    var showSupplierSheet by remember { mutableStateOf(false) }
    var showProductSheet by remember { mutableStateOf(false) }
    var itemToDelete by remember { mutableStateOf<DraftItem?>(null) }
    var galleryPreview by remember { mutableStateOf<ImageGalleryState?>(null) }

    BackHandler(enabled = showConfirmSubmit) {
        showConfirmSubmit = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Quay lại")
                    }
                },
                title = {
                    Column {
                        Text(
                            text = "Tạo phiếu nhập hàng",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Tự động lưu nháp trên máy",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.85f)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    navigationIconContentColor = Color.White,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                ),
                actions = {
                    IconButton(onClick = onRefreshCatalog) {
                        Icon(Icons.Default.Refresh, contentDescription = "Đồng bộ")
                    }
                }
            )
        },
        bottomBar = {
            Surface(
                shadowElevation = 8.dp,
                color = MaterialTheme.colorScheme.surface
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "${draft.totalUnits} SP • ${draft.items.size} mặt hàng",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = formatVnd(draft.totalAmount),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                text = "Trả ngay: ${formatVnd(draft.paidAmount)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = NkiotEmerald,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "Còn nợ: ${formatVnd(draft.remainingDebt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (draft.remainingDebt > 0) NkiotAmber else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = if (draft.remainingDebt > 0) FontWeight.SemiBold else FontWeight.Normal
                            )
                        }
                    }

                    if (isPending) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = onVerifyPending,
                                enabled = !uiState.isSubmitting,
                                colors = ButtonDefaults.buttonColors(containerColor = NkiotAmber),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.weight(1f).height(48.dp)
                            ) {
                                Text("Kiểm tra kết quả", fontWeight = FontWeight.Bold)
                            }
                            OutlinedButton(
                                onClick = onUnlockPending,
                                enabled = !uiState.isSubmitting,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.height(48.dp)
                            ) {
                                Text("Mở khóa")
                            }
                        }
                    } else {
                        Button(
                            onClick = { showConfirmSubmit = true },
                            enabled = !uiState.isSubmitting && draft.items.isNotEmpty(),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().height(50.dp)
                        ) {
                            if (uiState.isSubmitting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(22.dp),
                                    color = Color.White,
                                    strokeWidth = 2.dp
                                )
                                Spacer(Modifier.width(10.dp))
                                Text("Đang tải ảnh & lưu phiếu...")
                            } else {
                                Text("Hoàn tất nhập hàng", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (draft.copiedFrom.isNotBlank()) {
                item {
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "Đang sao chép từ phiếu ${draft.copiedFrom}",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            if (!uiState.bannerMessage.isNullOrBlank()) {
                item {
                    Surface(
                        color = NkiotEmeraldBg,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = uiState.bannerMessage,
                            color = NkiotEmerald,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            if (!uiState.errorMessage.isNullOrBlank()) {
                item {
                    Surface(
                        color = MaterialTheme.colorScheme.error.copy(alpha = 0.1f),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            if (isPending) {
                item {
                    Surface(
                        color = NkiotAmberBg,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "Phiếu đã gửi nhưng chưa rõ phản hồi (mã ${draft.pendingRequestId}). Bấm \"Kiểm tra kết quả\" bên dưới để tránh tạo phiếu trùng.",
                            color = NkiotAmber,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            // Branch & Supplier Card
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Store,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = "Chi nhánh:",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            TextButton(onClick = { showBranchMenu = true }, enabled = !isPending && !uiState.isSubmitting) {
                                Text(
                                    text = draft.branchName.ifBlank { "Chọn chi nhánh" },
                                    fontWeight = FontWeight.Bold
                                )
                                DropdownMenu(
                                    expanded = showBranchMenu,
                                    onDismissRequest = { showBranchMenu = false }
                                ) {
                                    uiState.branches.forEach { br ->
                                        DropdownMenuItem(
                                            text = { Text(br.name) },
                                            onClick = {
                                                onSelectBranch(br.name)
                                                showBranchMenu = false
                                            }
                                        )
                                    }
                                }
                            }
                        }

                        HorizontalDivider()

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !isPending && !uiState.isSubmitting) { showSupplierSheet = true }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Nhà cung cấp *",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = if (draft.supplierName.isNotBlank()) {
                                        draft.supplierName
                                    } else {
                                        "Chạm để chọn nhà cung cấp"
                                    },
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = if (draft.supplierName.isNotBlank()) FontWeight.SemiBold else FontWeight.Medium,
                                    color = if (draft.supplierName.isNotBlank()) MaterialTheme.colorScheme.onSurface else NkiotAmber
                                )
                            }
                            Icon(
                                Icons.Default.Search,
                                contentDescription = "Chọn NCC",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }

            // Quick Scan & Add Product Actions (Correct Icons!)
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Button(
                        onClick = { showProductSheet = true },
                        enabled = !isPending && !uiState.isSubmitting,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f).height(48.dp)
                    ) {
                        Icon(Icons.Default.Search, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Chọn hàng hóa", fontWeight = FontWeight.SemiBold)
                    }
                    OutlinedButton(
                        onClick = onOpenSkuScanner,
                        enabled = !isPending && !uiState.isSubmitting,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f).height(48.dp)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Quét mã hàng", fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            // Items List
            if (draft.items.isEmpty()) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = "Chưa có sản phẩm trong phiếu",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "Bấm 'Chọn hàng hóa' hoặc 'Quét mã hàng' để thêm sản phẩm, quét IMEI và đính kèm nhiều ảnh kiểm định.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            } else {
                items(draft.items, key = { it.productCode }) { item ->
                    DraftItemCard(
                        item = item,
                        disabled = isPending || uiState.isSubmitting,
                        showPrice = true,
                        onUpdateQty = { onUpdateQty(item.productCode, it) },
                        onUpdatePrice = { onUpdatePrice(item.productCode, it) },
                        onRemove = {
                            if (item.hasImei && item.imeis.isNotEmpty() || item.photos.isNotEmpty() || item.qty > 1) {
                                itemToDelete = item
                            } else {
                                onRemoveItem(item.productCode)
                            }
                        },
                        onScanImeis = { onOpenImeiScanner(item.productCode) },
                        onBulkPasteImeis = { onOpenBulkPasteImei(item.productCode, item.productName) },
                        onRemoveImei = { imei -> onRemoveImei(item.productCode, imei) },
                        onInspectImei = { imei -> onInspectImei(item.productCode, item.productName, imei) },
                        onInspectNormalProduct = { onInspectNormalProduct(item.productCode, item.productName) },
                        onViewGallery = { images, index ->
                            galleryPreview = ImageGalleryState(images = images, initialIndex = index)
                        }
                    )
                }
            }

            // Payment & Note Card — Always accessible when items exist
            if (draft.items.isNotEmpty()) item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = "Thanh toán & Ghi chú phiếu",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )

                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PaymentMode.entries.forEach { mode ->
                                FilterChip(
                                    selected = draft.paymentMode == mode,
                                    onClick = { onSelectPaymentMode(mode) },
                                    label = { Text(mode.label) }
                                )
                            }
                        }

                        if (draft.paymentMode == PaymentMode.PARTIAL) {
                            OutlinedTextField(
                                value = if (draft.partialPaidAmount == 0L) "" else draft.partialPaidAmount.toString(),
                                onValueChange = { raw ->
                                    val digits = raw.filter { it.isDigit() }
                                    onUpdatePartialPaid(digits.toLongOrNull() ?: 0L)
                                },
                                label = { Text("Số tiền trả ngay (VNĐ)") },
                                supportingText = {
                                    if (draft.partialPaidAmount > 0) {
                                        Text(
                                            text = formatVnd(draft.partialPaidAmount),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        if (draft.paymentMode != PaymentMode.UNPAID) {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PaymentMethod.entries.forEach { method ->
                                    FilterChip(
                                        selected = draft.paymentMethod == method,
                                        onClick = { onSelectPaymentMethod(method) },
                                        label = { Text(method.label) }
                                    )
                                }
                            }
                        }

                        OutlinedTextField(
                            value = draft.note,
                            onValueChange = onUpdateNote,
                            label = { Text("Ghi chú phiếu nhập") },
                            placeholder = { Text("Số hóa đơn NCC, người giao...") },
                            singleLine = false,
                            maxLines = 3,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }

    if (showConfirmSubmit) {
        val missingSupplier = draft.supplierName.isBlank()
        val emptyImeiItems = draft.items.filter { it.hasImei && it.imeis.isEmpty() }
        AlertDialog(
            onDismissRequest = { showConfirmSubmit = false },
            title = { Text("Xác nhận lưu phiếu nhập", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (missingSupplier) {
                        Surface(
                            color = NkiotAmberBg,
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = "Chưa chọn Nhà cung cấp",
                                    color = NkiotAmber,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.bodySmall
                                )
                                TextButton(
                                    onClick = {
                                        showConfirmSubmit = false
                                        showSupplierSheet = true
                                    },
                                    contentPadding = PaddingValues(0.dp)
                                ) {
                                    Text("Bấm vào đây để chọn Nhà cung cấp ngay →", fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                    if (emptyImeiItems.isNotEmpty()) {
                        Surface(
                            color = NkiotRed.copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "Chưa nhập IMEI cho: ${emptyImeiItems.joinToString { it.productName }}",
                                color = NkiotRed,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(10.dp)
                            )
                        }
                    }
                    Text("• Chi nhánh: ${draft.branchName.ifBlank { "Mặc định" }}", style = MaterialTheme.typography.bodySmall)
                    Text("• Nhà cung cấp: ${draft.supplierName.ifBlank { "Chưa chọn" }}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    Text("• Hàng hóa: ${draft.items.size} mặt hàng (${draft.totalUnits} SP)", style = MaterialTheme.typography.bodySmall)
                    HorizontalDivider()
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Tổng tiền hàng:", style = MaterialTheme.typography.bodySmall)
                        Text(formatVnd(draft.totalAmount), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Trả ngay (${draft.paymentMethod.label}):", style = MaterialTheme.typography.bodySmall)
                        Text(formatVnd(draft.paidAmount), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = NkiotEmerald)
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Ghi nợ NCC:", style = MaterialTheme.typography.bodySmall)
                        Text(formatVnd(draft.remainingDebt), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = if (draft.remainingDebt > 0) NkiotAmber else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showConfirmSubmit = false
                        onSubmit()
                    },
                    enabled = !missingSupplier && emptyImeiItems.isEmpty() && !uiState.isSubmitting
                ) {
                    Text("Xác nhận & Lưu phiếu", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmSubmit = false }) {
                    Text("Kiểm tra lại")
                }
            }
        )
    }

    if (showSupplierSheet) {
        SupplierPickerSheet(
            suppliers = uiState.suppliers,
            onSelect = {
                onSelectSupplier(it)
                showSupplierSheet = false
            },
            onCreateNew = {
                showSupplierSheet = false
                onOpenQuickAddSupplier()
            },
            onDismiss = { showSupplierSheet = false }
        )
    }

    if (showProductSheet) {
        ProductPickerSheet(
            products = branchProducts,
            onSelect = {
                onAddProduct(it)
                showProductSheet = false
            },
            onCreateNew = {
                showProductSheet = false
                onOpenQuickAddProduct()
            },
            onDismiss = { showProductSheet = false }
        )
    }

    itemToDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { itemToDelete = null },
            title = { Text("Xóa sản phẩm khỏi phiếu?", fontWeight = FontWeight.Bold) },
            text = {
                val detail = if (item.hasImei) "${item.imeis.size} IMEI và ảnh kiểm định" else "${item.qty} sản phẩm"
                Text("Toàn bộ thông tin, $detail của '${item.productName}' sẽ bị xóa khỏi phiếu.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        onRemoveItem(item.productCode)
                        itemToDelete = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = NkiotRed)
                ) {
                    Text("Xóa dòng")
                }
            },
            dismissButton = {
                TextButton(onClick = { itemToDelete = null }) {
                    Text("Giữ lại")
                }
            }
        )
    }

    if (galleryPreview != null) {
        FullscreenImageViewer(
            imageModel = galleryPreview,
            onDismiss = { galleryPreview = null }
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DraftItemCard(
    item: DraftItem,
    disabled: Boolean,
    showPrice: Boolean = true,
    onUpdateQty: (Int) -> Unit,
    onUpdatePrice: (Long) -> Unit,
    onRemove: () -> Unit,
    onScanImeis: () -> Unit,
    onBulkPasteImeis: () -> Unit,
    onRemoveImei: (String) -> Unit,
    onInspectImei: (String) -> Unit,
    onInspectNormalProduct: () -> Unit,
    onViewPhoto: (String) -> Unit = {},
    onViewGallery: (List<String>, Int) -> Unit = { list, idx ->
        list.getOrNull(idx)?.let(onViewPhoto)
    }
) {
    var priceText by remember(item.productCode, item.unitPrice) {
        mutableStateOf(if (item.unitPrice == 0L) "" else item.unitPrice.toString())
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.productName,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${item.productCode} • ${if (item.hasImei) "Quản lý IMEI" else "Hàng thường"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(onClick = onRemove, enabled = !disabled) {
                    Icon(
                        Icons.Default.DeleteOutline,
                        contentDescription = "Xóa dòng",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Price & Quantity row (Always visible and balanced)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (showPrice) OutlinedTextField(
                    value = priceText,
                    onValueChange = { raw ->
                        val digits = raw.filter { it.isDigit() }
                        priceText = digits
                        onUpdatePrice(digits.toLongOrNull() ?: 0L)
                    },
                    enabled = !disabled,
                    label = { Text("Đơn giá nhập") },
                    supportingText = {
                        val num = priceText.toLongOrNull() ?: 0L
                        Text(formatVnd(num), style = MaterialTheme.typography.labelSmall)
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )

                if (item.hasImei) {
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = "${item.imeis.size}",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Text(
                                text = "IMEI",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                } else {
                    var qtyText by remember(item.qty) { mutableStateOf(item.qty.toString()) }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        IconButton(
                            onClick = {
                                val next = (item.qty - 1).coerceAtLeast(1)
                                onUpdateQty(next)
                            },
                            enabled = !disabled && item.qty > 1
                        ) {
                            Icon(Icons.Default.Remove, contentDescription = "Giảm")
                        }
                        OutlinedTextField(
                            value = qtyText,
                            onValueChange = { raw ->
                                val digits = raw.filter { it.isDigit() }
                                qtyText = digits
                                val q = digits.toIntOrNull()
                                if (q != null && q > 0) {
                                    onUpdateQty(q)
                                }
                            },
                            enabled = !disabled,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            textStyle = MaterialTheme.typography.titleSmall.copy(
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                fontWeight = FontWeight.Bold
                            ),
                            modifier = Modifier.width(64.dp)
                        )
                        IconButton(
                            onClick = { onUpdateQty(item.qty + 1) },
                            enabled = !disabled
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Tăng")
                        }
                    }
                }
            }

            // IMEI vs Normal inspection section
            if (item.hasImei) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onScanImeis,
                        enabled = !disabled,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Quét IMEI", style = MaterialTheme.typography.labelMedium)
                    }
                    OutlinedButton(
                        onClick = onBulkPasteImeis,
                        enabled = !disabled,
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.ContentPaste, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Nhập / Dán IMEI", style = MaterialTheme.typography.labelMedium)
                    }
                }

                if (item.imeis.isEmpty()) {
                    Text(
                        text = "Nhập hoặc quét IMEI. Mỗi máy có bộ ảnh & mô tả kiểm định riêng.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        item.imeis.forEachIndexed { imeiIdx, imei ->
                            val detail: DraftImeiDetail? = item.imeiDetails[imei]
                            val photos = detail?.photos.orEmpty()
                            val hasInspection = detail?.condition != null ||
                                !detail?.conditionDetail.isNullOrBlank() ||
                                photos.isNotEmpty()

                            Surface(
                                color = if (hasInspection) NkiotEmeraldBg else NkiotAmberBg,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(enabled = !disabled) { onInspectImei(imei) }
                            ) {
                                Column(
                                    modifier = Modifier.padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    // Row 1: Full-width 1-line IMEI + compact action & remove buttons
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = "#${imeiIdx + 1} • $imei",
                                                style = MaterialTheme.typography.bodyMedium,
                                                fontWeight = FontWeight.Bold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            val statusParts = buildList {
                                                if (detail?.condition != null) {
                                                    add(inspectionConditionLabel(detail.condition))
                                                }
                                                if (photos.isEmpty()) {
                                                    add("Chưa có ảnh")
                                                } else {
                                                    add("${photos.size} ảnh kiểm định")
                                                }
                                            }
                                            Text(
                                                text = statusParts.joinToString(" • "),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = if (hasInspection) NkiotEmerald else NkiotAmber,
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            OutlinedButton(
                                                onClick = { if (!disabled) onInspectImei(imei) },
                                                enabled = !disabled,
                                                shape = RoundedCornerShape(8.dp),
                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                modifier = Modifier.height(36.dp)
                                            ) {
                                                Icon(
                                                    imageVector = if (hasInspection) Icons.Default.Verified else Icons.Default.CameraAlt,
                                                    contentDescription = null,
                                                    tint = if (hasInspection) NkiotEmerald else MaterialTheme.colorScheme.primary,
                                                    modifier = Modifier.size(14.dp)
                                                )
                                                Spacer(Modifier.width(4.dp))
                                                Text(
                                                    text = if (photos.isEmpty()) "Thêm ảnh" else "Ảnh / Mô tả",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    fontWeight = FontWeight.SemiBold
                                                )
                                            }
                                            IconButton(
                                                onClick = { onRemoveImei(imei) },
                                                enabled = !disabled,
                                                modifier = Modifier.size(34.dp)
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.Close,
                                                    contentDescription = "Xóa IMEI",
                                                    modifier = Modifier.size(16.dp)
                                                )
                                            }
                                        }
                                    }

                                    if (!detail?.conditionDetail.isNullOrBlank()) {
                                        Text(
                                            text = detail!!.conditionDetail,
                                            style = MaterialTheme.typography.bodySmall,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }

                                    if (photos.isNotEmpty()) {
                                        val allPaths = remember(photos) { photos.map { it.localPath } }
                                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            itemsIndexed(photos, key = { _, it -> it.localPath }) { idx, photo ->
                                                AsyncImage(
                                                    model = File(photo.localPath),
                                                    contentDescription = "Ảnh máy IMEI $imei",
                                                    contentScale = ContentScale.Crop,
                                                    modifier = Modifier
                                                        .size(60.dp)
                                                        .clip(RoundedCornerShape(8.dp))
                                                        .clickable(enabled = !disabled) {
                                                            onViewGallery(allPaths, idx)
                                                        }
                                                )
                                            }
                                            item {
                                                Box(
                                                    modifier = Modifier
                                                        .size(60.dp)
                                                        .clip(RoundedCornerShape(8.dp))
                                                        .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                                                        .background(Color.White.copy(alpha = 0.6f))
                                                        .clickable(enabled = !disabled) { onInspectImei(imei) },
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.AddPhotoAlternate,
                                                        contentDescription = "Thêm ảnh",
                                                        tint = MaterialTheme.colorScheme.primary,
                                                        modifier = Modifier.size(20.dp)
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                val photos = item.photos
                val hasMeta = item.condition != null || item.conditionDetail.isNotBlank() || photos.isNotEmpty()
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { if (!disabled) onInspectNormalProduct() },
                        enabled = !disabled,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            imageVector = if (hasMeta) Icons.Default.Verified else Icons.Default.CameraAlt,
                            contentDescription = null,
                            tint = if (hasMeta) NkiotEmerald else MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        val label = if (photos.isEmpty()) "Thêm ảnh & Mô tả sản phẩm" else "Ảnh & Mô tả sản phẩm (${photos.size} ảnh)"
                        Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    }
                    if (item.condition != null || item.conditionDetail.isNotBlank()) {
                        val metaText = buildList {
                            if (item.condition != null) add(inspectionConditionLabel(item.condition))
                            if (item.conditionDetail.isNotBlank()) add(item.conditionDetail)
                        }.joinToString(" • ")
                        Text(
                            text = metaText,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (photos.isNotEmpty()) {
                        val allPaths = remember(photos) { photos.map { it.localPath } }
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            itemsIndexed(photos, key = { _, it -> it.localPath }) { idx, photo ->
                                AsyncImage(
                                    model = File(photo.localPath),
                                    contentDescription = "Ảnh sản phẩm",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .size(64.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable(enabled = !disabled) {
                                            onViewGallery(allPaths, idx)
                                        }
                                )
                            }
                            item {
                                Box(
                                    modifier = Modifier
                                        .size(64.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f))
                                        .clickable(enabled = !disabled) { onInspectNormalProduct() },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.AddPhotoAlternate,
                                        contentDescription = "Thêm ảnh",
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (showPrice) Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                Text(
                    text = "Thành tiền: ${formatVnd(item.lineTotal)}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@androidx.compose.ui.tooling.preview.Preview(showBackground = true, widthDp = 360)
@Composable
private fun UsedPhoneCardPreview() {
    MaterialTheme {
        DraftItemCard(
            item = DraftItem(
                productCode = "PHONE_DEMO",
                productName = "iPhone 13 128GB • Máy cũ",
                hasImei = true,
                imeis = listOf("356789012345678", "356789012345679")
            ),
            disabled = false,
            showPrice = false,
            onUpdateQty = {}, onUpdatePrice = {}, onRemove = {},
            onScanImeis = {}, onBulkPasteImeis = {}, onRemoveImei = {},
            onInspectImei = {}, onInspectNormalProduct = {}, onViewPhoto = {}
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SupplierPickerSheet(
    suppliers: List<SupplierDto>,
    onSelect: (SupplierDto) -> Unit,
    onCreateNew: () -> Unit,
    onDismiss: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(suppliers, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) suppliers
        else suppliers.filter {
            it.name.lowercase().contains(q) ||
                it.code.lowercase().contains(q) ||
                it.phone.lowercase().contains(q)
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Chọn nhà cung cấp", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                TextButton(onClick = onCreateNew) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Thêm NCC mới", fontWeight = FontWeight.SemiBold)
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Tìm tên nhà cung cấp...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            LazyColumn(
                modifier = Modifier.height(360.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(filtered, key = { it.code }) { sup ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(sup) },
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(sup.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                text = "${sup.code}${if (sup.phone.isNotBlank()) " • ${sup.phone}" else ""} • Nợ: ${formatVnd(sup.debt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProductPickerSheet(
    products: List<ProductDto>,
    onSelect: (ProductDto) -> Unit,
    onCreateNew: (() -> Unit)?,
    onDismiss: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(products, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) products.take(60)
        else products.filter {
            it.name.lowercase().contains(q) ||
                it.code.lowercase().contains(q) ||
                it.barcode.lowercase().contains(q)
        }.take(60)
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Chọn sản phẩm", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (onCreateNew != null) {
                    TextButton(onClick = onCreateNew) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("Thêm SP mới", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Tìm tên, mã SKU, mã vạch...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            LazyColumn(
                modifier = Modifier.height(380.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(filtered, key = { "${it.branch}_${it.code}_${it.id}" }) { prod ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(prod) },
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = prod.name,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${prod.code}${if (prod.hasImei) " • IMEI" else ""} • Tồn: ${prod.stock}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = formatVnd(prod.costPrice),
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }
        }
    }
}
