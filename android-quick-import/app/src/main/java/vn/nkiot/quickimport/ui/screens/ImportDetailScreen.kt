package vn.nkiot.quickimport.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import vn.nkiot.quickimport.data.model.DeviceCondition
import vn.nkiot.quickimport.data.model.ImportItemDto
import vn.nkiot.quickimport.data.model.ImportItemPayload
import vn.nkiot.quickimport.data.model.ImportRecordDto
import vn.nkiot.quickimport.data.model.PaymentMethod
import vn.nkiot.quickimport.data.model.ProductDto
import vn.nkiot.quickimport.data.model.ReturnImportItemPayload
import vn.nkiot.quickimport.data.repository.QuickImportRepository
import vn.nkiot.quickimport.ui.theme.NkiotAmber
import vn.nkiot.quickimport.ui.theme.NkiotAmberBg
import vn.nkiot.quickimport.ui.theme.NkiotEmerald
import vn.nkiot.quickimport.ui.theme.NkiotEmeraldBg
import vn.nkiot.quickimport.ui.theme.NkiotRed
import vn.nkiot.quickimport.ui.util.formatVnd
import vn.nkiot.quickimport.ui.viewmodel.ImportReturnSummary

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ImportDetailScreen(
    imp: ImportRecordDto,
    returnSummary: ImportReturnSummary,
    branchProducts: List<ProductDto>,
    isSubmitting: Boolean,
    errorMessage: String?,
    bannerMessage: String?,
    resolveMediaUrl: (String) -> String,
    cookieHeader: String?,
    productLookup: (String) -> ProductDto?,
    onBack: () -> Unit,
    onCopyImport: () -> Unit,
    onCancelImport: (reason: String, refundMethod: PaymentMethod) -> Unit,
    onReturnImport: (items: List<ReturnImportItemPayload>, refundMethod: PaymentMethod, reason: String) -> Unit,
    onExchangeImport: (
        returnItems: List<ReturnImportItemPayload>,
        exchangeItems: List<ImportItemPayload>,
        method: PaymentMethod,
        reason: String
    ) -> Unit
) {
    val isCancelled = imp.status == "cancelled"
    var showCancelDialog by remember { mutableStateOf(false) }
    var showReturnSheet by remember { mutableStateOf(false) }
    var showExchangeSheet by remember { mutableStateOf(false) }
    var galleryPreview by remember { mutableStateOf<ImageGalleryState?>(null) }

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
                        Text(imp.code, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            text = "${imp.branch} • ${imp.time.ifBlank { imp.createdAt }}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.85f)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    navigationIconContentColor = Color.White,
                    titleContentColor = Color.White
                )
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (!bannerMessage.isNullOrBlank()) {
                item {
                    Surface(color = NkiotEmeraldBg, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = bannerMessage,
                            color = NkiotEmerald,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }
            if (!errorMessage.isNullOrBlank()) {
                item {
                    Surface(color = NkiotRed.copy(alpha = 0.1f), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = errorMessage,
                            color = NkiotRed,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                }
            }

            // Header Info Card
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = imp.nccName.ifBlank { imp.nccCode },
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Surface(
                                color = if (isCancelled) NkiotRed.copy(alpha = 0.12f) else NkiotEmeraldBg,
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text(
                                    text = if (isCancelled) "Đã hủy" else "Đã nhập",
                                    color = if (isCancelled) NkiotRed else NkiotEmerald,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }
                        Text("Mã NCC: ${imp.nccCode} • Người tạo: ${imp.creator}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (imp.copiedFrom.isNotBlank()) {
                            Text("Sao chép từ: ${imp.copiedFrom}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        }
                        if (imp.note.isNotBlank()) {
                            Text("Ghi chú: ${imp.note}", style = MaterialTheme.typography.bodySmall)
                        }
                        if (isCancelled && imp.cancelReason.isNotBlank()) {
                            Text("Lý do hủy: ${imp.cancelReason}", style = MaterialTheme.typography.bodySmall, color = NkiotRed)
                        }
                    }
                }
            }

            // Action Buttons (Matching Web: Đổi hàng NCC, Trả hàng NCC, Sao chép, Hủy phiếu)
            item {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (!isCancelled) {
                        Button(
                            onClick = { showReturnSheet = true },
                            enabled = !isSubmitting,
                            colors = ButtonDefaults.buttonColors(containerColor = NkiotAmber),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Trả hàng NCC", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = { showExchangeSheet = true },
                            enabled = !isSubmitting,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Đổi hàng NCC", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = { showCancelDialog = true },
                            enabled = !isSubmitting,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = NkiotRed),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.Cancel, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Hủy phiếu", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        }
                    }
                    OutlinedButton(
                        onClick = onCopyImport,
                        enabled = !isSubmitting,
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Sao chép phiếu", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            // Items List
            item {
                Text(
                    text = "Chi tiết hàng nhập (${imp.items.size} mã)",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
            }

            items(imp.items, key = { it.code }) { row ->
                ImportDetailItemCard(
                    row = row,
                    returnedQty = returnSummary.returnedQtyByCode[row.code] ?: 0,
                    returnedSerials = returnSummary.returnedSerials,
                    resolveMediaUrl = resolveMediaUrl,
                    cookieHeader = cookieHeader,
                    onViewGallery = { urls, index ->
                        galleryPreview = ImageGalleryState(
                            images = urls.map(resolveMediaUrl),
                            initialIndex = index
                        )
                    }
                )
            }

            // Payment Summary
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text("Thanh toán", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        SummaryRow("Tổng tiền hàng", formatVnd(imp.needPay), bold = true)
                        SummaryRow("Đã trả NCC (${PaymentMethod.fromApi(imp.paymentMethod).label})", formatVnd(imp.paid))
                        val debt = (imp.needPay - imp.paid).coerceAtLeast(0L)
                        SummaryRow("Còn nợ ban đầu", formatVnd(debt), highlightColor = if (debt > 0) NkiotAmber else NkiotEmerald)
                    }
                }
            }

            // Return History
            if (returnSummary.returnRecords.isNotEmpty()) {
                item {
                    Text(
                        text = "Lịch sử Trả hàng NCC (${returnSummary.returnRecords.size})",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }
                items(returnSummary.returnRecords, key = { it.code }) { ret ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = NkiotAmberBg)
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("↩ ${ret.code}", fontWeight = FontWeight.Bold, color = NkiotAmber)
                                Text(formatVnd(ret.totalRefund), fontWeight = FontWeight.Bold)
                            }
                            Text(
                                text = "${ret.time.ifBlank { ret.createdAt }} • ${ret.items.sumOf { it.qty }} SP • Cấn nợ: ${formatVnd(ret.debtReduced)} • Hoàn tiền: ${formatVnd(ret.cashBack)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            if (ret.reason.isNotBlank()) {
                                Text("Lý do: ${ret.reason}", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCancelDialog) {
        CancelImportDialog(
            importCode = imp.code,
            paidAmount = imp.paid,
            isSubmitting = isSubmitting,
            onConfirm = { reason, method ->
                onCancelImport(reason, method)
                showCancelDialog = false
            },
            onDismiss = { showCancelDialog = false }
        )
    }

    if (showReturnSheet) {
        ImportReturnSheet(
            imp = imp,
            returnSummary = returnSummary,
            productLookup = productLookup,
            isSubmitting = isSubmitting,
            onSubmit = { items, method, reason ->
                onReturnImport(items, method, reason)
                showReturnSheet = false
            },
            onDismiss = { showReturnSheet = false }
        )
    }

    if (showExchangeSheet) {
        ImportExchangeSheet(
            imp = imp,
            returnSummary = returnSummary,
            branchProducts = branchProducts,
            productLookup = productLookup,
            isSubmitting = isSubmitting,
            onSubmit = { retItems, exItems, method, reason ->
                onExchangeImport(retItems, exItems, method, reason)
                showExchangeSheet = false
            },
            onDismiss = { showExchangeSheet = false }
        )
    }

    if (galleryPreview != null) {
        FullscreenImageViewer(
            imageModel = galleryPreview,
            cookieHeader = cookieHeader,
            onDismiss = { galleryPreview = null }
        )
    }
}

@Composable
private fun SummaryRow(label: String, value: String, bold: Boolean = false, highlightColor: Color? = null) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (bold || highlightColor != null) FontWeight.Bold else FontWeight.Medium,
            color = highlightColor ?: MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
private fun ImportDetailItemCard(
    row: ImportItemDto,
    returnedQty: Int,
    returnedSerials: Set<String>,
    resolveMediaUrl: (String) -> String,
    cookieHeader: String?,
    onViewGallery: (List<String>, Int) -> Unit
) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(row.name.ifBlank { row.code }, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        text = "${row.code} • ${row.qty} × ${formatVnd(row.price)}${if (returnedQty > 0) " • Đã trả $returnedQty" else ""}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(formatVnd(row.total), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }

            if (row.hasImei && row.imeis.isNotEmpty()) {
                HorizontalDivider()
                row.imeis.forEach { imei ->
                    val detail = row.imeiDetails[imei]
                    val wasReturned = imei in returnedSerials
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "• $imei${if (wasReturned) " (Đã trả NCC)" else ""}",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (wasReturned) NkiotAmber else MaterialTheme.colorScheme.onSurface
                            )
                            DeviceCondition.fromApi(detail?.condition)?.let { cond ->
                                Text(cond.label, style = MaterialTheme.typography.labelSmall, color = NkiotEmerald)
                            }
                        }
                        if (!detail?.conditionDetail.isNullOrBlank()) {
                            Text(
                                text = detail!!.conditionDetail,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (!detail?.images.isNullOrEmpty()) {
                            val imgs = detail!!.images
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                itemsIndexed(imgs) { idx, imgUrl ->
                                    val req = ImageRequest.Builder(context)
                                        .data(resolveMediaUrl(imgUrl))
                                        .apply { if (cookieHeader != null) addHeader("Cookie", cookieHeader) }
                                        .crossfade(true)
                                        .build()
                                    AsyncImage(
                                        model = req,
                                        contentDescription = "Ảnh kiểm định",
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .size(64.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .clickable { onViewGallery(imgs, idx) }
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                if (row.conditionDetail.isNotBlank()) {
                    Text("Tình trạng: ${row.conditionDetail}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (row.images.isNotEmpty()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        itemsIndexed(row.images) { idx, imgUrl ->
                            val req = ImageRequest.Builder(context)
                                .data(resolveMediaUrl(imgUrl))
                                .apply { if (cookieHeader != null) addHeader("Cookie", cookieHeader) }
                                .crossfade(true)
                                .build()
                            AsyncImage(
                                model = req,
                                contentDescription = "Ảnh sản phẩm",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .size(64.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onViewGallery(row.images, idx) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CancelImportDialog(
    importCode: String,
    paidAmount: Long,
    isSubmitting: Boolean,
    onConfirm: (String, PaymentMethod) -> Unit,
    onDismiss: () -> Unit
) {
    var reason by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(PaymentMethod.CASH) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Hủy phiếu nhập $importCode", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "Hệ thống sẽ trừ tồn kho, gỡ IMEI và hoàn lại công nợ/sổ quỹ theo đúng phiếu nhập gốc.",
                    style = MaterialTheme.typography.bodySmall
                )
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Lý do hủy phiếu") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (paidAmount > 0) {
                    Text("Phương thức nhận hoàn ${formatVnd(paidAmount)}:", style = MaterialTheme.typography.labelSmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PaymentMethod.entries.forEach { m ->
                            FilterChip(selected = method == m, onClick = { method = m }, label = { Text(m.label) })
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(reason, method) },
                enabled = !isSubmitting,
                colors = ButtonDefaults.buttonColors(containerColor = NkiotRed)
            ) {
                Text("Xác nhận hủy")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Đóng") }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ImportReturnSheet(
    imp: ImportRecordDto,
    returnSummary: ImportReturnSummary,
    productLookup: (String) -> ProductDto?,
    isSubmitting: Boolean,
    onSubmit: (List<ReturnImportItemPayload>, PaymentMethod, String) -> Unit,
    onDismiss: () -> Unit
) {
    val normalQtyMap = remember { mutableStateMapOf<String, Int>() }
    val selectedImeisMap = remember { mutableStateMapOf<String, Set<String>>() }
    var method by remember { mutableStateOf(PaymentMethod.fromApi(imp.paymentMethod)) }
    var reason by remember { mutableStateOf("") }

    fun collectItems(): List<ReturnImportItemPayload> {
        return imp.items.mapNotNull { row ->
            if (row.hasImei) {
                val chosen = selectedImeisMap[row.code].orEmpty().toList()
                if (chosen.isEmpty()) null else ReturnImportItemPayload(code = row.code, qty = chosen.size, imeis = chosen)
            } else {
                val qty = normalQtyMap[row.code] ?: 0
                if (qty <= 0) null else ReturnImportItemPayload(code = row.code, qty = qty)
            }
        }
    }

    val previewItems = collectItems()
    val totalRefund = previewItems.sumOf { ret ->
        val price = imp.items.firstOrNull { it.code == ret.code }?.price ?: 0L
        ret.qty.toLong() * price
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Trả hàng nhà cung cấp (${imp.code})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

            imp.items.forEach { row ->
                val returnedBefore = returnSummary.returnedQtyByCode[row.code] ?: 0
                val maxReturnable = (row.qty - returnedBefore).coerceAtLeast(0)
                val currentProd = productLookup(row.code)
                val inStockImeis = currentProd?.imeis?.toSet().orEmpty()

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(row.name.ifBlank { row.code }, fontWeight = FontWeight.SemiBold)
                        Text(
                            text = "Giá nhập: ${formatVnd(row.price)} • Có thể trả: $maxReturnable/${row.qty}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        if (row.hasImei) {
                            val eligible = row.imeis.filter { it !in returnSummary.returnedSerials && it in inStockImeis }
                            if (eligible.isEmpty()) {
                                Text("Không còn IMEI nào trong kho để trả.", style = MaterialTheme.typography.labelSmall, color = NkiotAmber)
                            } else {
                                eligible.forEach { imei ->
                                    val chosen = selectedImeisMap[row.code].orEmpty()
                                    val checked = imei in chosen
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                selectedImeisMap[row.code] = if (checked) chosen - imei else chosen + imei
                                            }
                                    ) {
                                        Checkbox(
                                            checked = checked,
                                            onCheckedChange = {
                                                selectedImeisMap[row.code] = if (checked) chosen - imei else chosen + imei
                                            }
                                        )
                                        Text(imei, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        } else {
                            val maxStock = minOf(maxReturnable, currentProd?.stock ?: maxReturnable)
                            val qty = normalQtyMap[row.code] ?: 0
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("SL trả:", style = MaterialTheme.typography.bodySmall)
                                Spacer(Modifier.width(8.dp))
                                IconButton(onClick = { normalQtyMap[row.code] = (qty - 1).coerceAtLeast(0) }) {
                                    Icon(Icons.Default.Remove, contentDescription = "Giảm")
                                }
                                Text("$qty", fontWeight = FontWeight.Bold)
                                IconButton(onClick = { normalQtyMap[row.code] = (qty + 1).coerceAtMost(maxStock) }) {
                                    Icon(Icons.Default.Add, contentDescription = "Tăng")
                                }
                            }
                        }
                    }
                }
            }

            Text("Tổng giá trị trả NCC: ${formatVnd(totalRefund)}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaymentMethod.entries.forEach { m ->
                    FilterChip(selected = method == m, onClick = { method = m }, label = { Text(m.label) })
                }
            }

            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Lý do trả hàng") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = { onSubmit(previewItems, method, reason) },
                enabled = !isSubmitting && previewItems.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = NkiotAmber),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Xác nhận trả hàng NCC", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

private data class ExchangeNewRow(
    val product: ProductDto,
    val qty: Int = 1,
    val price: Long = product.costPrice,
    val imeisText: String = ""
) {
    val parsedImeis: List<String>
        get() = QuickImportRepository.parseBulkImeis(imeisText)
    val effectiveQty: Int
        get() = if (product.hasImei) parsedImeis.size else qty
    val total: Long
        get() = effectiveQty.toLong() * price
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ImportExchangeSheet(
    imp: ImportRecordDto,
    returnSummary: ImportReturnSummary,
    branchProducts: List<ProductDto>,
    productLookup: (String) -> ProductDto?,
    isSubmitting: Boolean,
    onSubmit: (
        returnItems: List<ReturnImportItemPayload>,
        exchangeItems: List<ImportItemPayload>,
        method: PaymentMethod,
        reason: String
    ) -> Unit,
    onDismiss: () -> Unit
) {
    val normalReturnQty = remember { mutableStateMapOf<String, Int>() }
    val selectedReturnImeis = remember { mutableStateMapOf<String, Set<String>>() }
    var newRows by remember { mutableStateOf<List<ExchangeNewRow>>(emptyList()) }
    var showPickProduct by remember { mutableStateOf(false) }
    var method by remember { mutableStateOf(PaymentMethod.TRANSFER) }
    var reason by remember { mutableStateOf("Đổi hàng NCC") }

    val returnItems = imp.items.mapNotNull { row ->
        if (row.hasImei) {
            val chosen = selectedReturnImeis[row.code].orEmpty().toList()
            if (chosen.isEmpty()) null else ReturnImportItemPayload(code = row.code, qty = chosen.size, imeis = chosen)
        } else {
            val q = normalReturnQty[row.code] ?: 0
            if (q <= 0) null else ReturnImportItemPayload(code = row.code, qty = q)
        }
    }
    val returnValue = returnItems.sumOf { r ->
        val p = imp.items.firstOrNull { it.code == r.code }?.price ?: 0L
        r.qty.toLong() * p
    }
    val exchangePayloads = newRows.mapNotNull { r ->
        if (r.effectiveQty <= 0) null
        else ImportItemPayload(
            code = r.product.code,
            qty = r.effectiveQty,
            price = r.price,
            hasImei = r.product.hasImei,
            imeis = if (r.product.hasImei) r.parsedImeis else emptyList()
        )
    }
    val exchangeValue = newRows.sumOf { it.total }
    val net = exchangeValue - returnValue

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Đổi hàng với NCC (${imp.code})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

            // Step 1: Return items
            Text("1. Chọn hàng trả lại NCC", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            imp.items.forEach { row ->
                val returnedBefore = returnSummary.returnedQtyByCode[row.code] ?: 0
                val maxReturnable = (row.qty - returnedBefore).coerceAtLeast(0)
                val currentProd = productLookup(row.code)
                val inStockImeis = currentProd?.imeis?.toSet().orEmpty()

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("${row.name.ifBlank { row.code }} (${formatVnd(row.price)})", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                        if (row.hasImei) {
                            val eligible = row.imeis.filter { it !in returnSummary.returnedSerials && it in inStockImeis }
                            eligible.forEach { imei ->
                                val chosen = selectedReturnImeis[row.code].orEmpty()
                                val checked = imei in chosen
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth().clickable {
                                        selectedReturnImeis[row.code] = if (checked) chosen - imei else chosen + imei
                                    }
                                ) {
                                    Checkbox(
                                        checked = checked,
                                        onCheckedChange = {
                                            selectedReturnImeis[row.code] = if (checked) chosen - imei else chosen + imei
                                        }
                                    )
                                    Text(imei, style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        } else {
                            val maxStock = minOf(maxReturnable, currentProd?.stock ?: maxReturnable)
                            val qty = normalReturnQty[row.code] ?: 0
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("SL trả:", style = MaterialTheme.typography.labelSmall)
                                IconButton(onClick = { normalReturnQty[row.code] = (qty - 1).coerceAtLeast(0) }) {
                                    Icon(Icons.Default.Remove, contentDescription = null)
                                }
                                Text("$qty", fontWeight = FontWeight.Bold)
                                IconButton(onClick = { normalReturnQty[row.code] = (qty + 1).coerceAtMost(maxStock) }) {
                                    Icon(Icons.Default.Add, contentDescription = null)
                                }
                            }
                        }
                    }
                }
            }

            // Step 2: Replacement items from supplier
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("2. Hàng NCC đổi lại", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                TextButton(onClick = { showPickProduct = true }) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Chọn SP đổi")
                }
            }

            newRows.forEachIndexed { idx, row ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(row.product.name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            IconButton(onClick = { newRows = newRows.filterIndexed { i, _ -> i != idx } }) {
                                Icon(Icons.Default.DeleteOutline, contentDescription = "Xóa")
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = if (row.price == 0L) "" else row.price.toString(),
                                onValueChange = { raw ->
                                    val p = raw.filter { it.isDigit() }.toLongOrNull() ?: 0L
                                    newRows = newRows.mapIndexed { i, r -> if (i == idx) r.copy(price = p) else r }
                                },
                                label = { Text("Đơn giá") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            if (!row.product.hasImei) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(onClick = {
                                        newRows = newRows.mapIndexed { i, r -> if (i == idx) r.copy(qty = (r.qty - 1).coerceAtLeast(1)) else r }
                                    }) { Icon(Icons.Default.Remove, contentDescription = null) }
                                    Text("${row.qty}", fontWeight = FontWeight.Bold)
                                    IconButton(onClick = {
                                        newRows = newRows.mapIndexed { i, r -> if (i == idx) r.copy(qty = r.qty + 1) else r }
                                    }) { Icon(Icons.Default.Add, contentDescription = null) }
                                }
                            }
                        }
                        if (row.product.hasImei) {
                            OutlinedTextField(
                                value = row.imeisText,
                                onValueChange = { txt ->
                                    newRows = newRows.mapIndexed { i, r -> if (i == idx) r.copy(imeisText = txt) else r }
                                },
                                label = { Text("IMEI máy đổi mới (cách nhau xuống dòng / dấu phẩy)") },
                                minLines = 2,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
            }

            // Net settlement summary
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SummaryRow("Giá trị hàng trả NCC", formatVnd(returnValue))
                    SummaryRow("Giá trị hàng NCC đổi lại", formatVnd(exchangeValue))
                    val netLabel = when {
                        net > 0 -> "Chi thêm cho NCC: ${formatVnd(net)}"
                        net < 0 -> "NCC hoàn thêm: ${formatVnd(-net)}"
                        else -> "Ngang giá (không phát sinh thu/chi)"
                    }
                    Text(netLabel, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaymentMethod.entries.forEach { m ->
                    FilterChip(selected = method == m, onClick = { method = m }, label = { Text(m.label) })
                }
            }

            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Lý do đổi hàng") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = { onSubmit(returnItems, exchangePayloads, method, reason) },
                enabled = !isSubmitting && returnItems.isNotEmpty() && exchangePayloads.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Xác nhận đổi hàng NCC", fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    if (showPickProduct) {
        ProductPickerSheet(
            products = branchProducts,
            onSelect = { prod ->
                if (newRows.none { it.product.code == prod.code }) {
                    newRows = newRows + ExchangeNewRow(product = prod)
                }
                showPickProduct = false
            },
            onCreateNew = null,
            onDismiss = { showPickProduct = false }
        )
    }
}
