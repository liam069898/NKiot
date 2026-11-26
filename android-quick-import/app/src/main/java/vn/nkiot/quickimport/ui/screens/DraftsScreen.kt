package vn.nkiot.quickimport.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import vn.nkiot.quickimport.data.local.ImportDraftEntity
import vn.nkiot.quickimport.data.model.ImportRecordDto
import vn.nkiot.quickimport.ui.theme.NkiotAmber
import vn.nkiot.quickimport.ui.theme.NkiotAmberBg
import vn.nkiot.quickimport.ui.theme.NkiotEmerald
import vn.nkiot.quickimport.ui.theme.NkiotEmeraldBg
import vn.nkiot.quickimport.ui.theme.NkiotRed
import vn.nkiot.quickimport.ui.util.formatTimestamp
import vn.nkiot.quickimport.ui.util.formatVnd
import vn.nkiot.quickimport.ui.viewmodel.ImportReturnSummary
import vn.nkiot.quickimport.ui.viewmodel.QuickImportUiState

private enum class ImportStatusFilter(val label: String) {
    ALL("Tất cả"),
    IMPORTED("Đã nhập"),
    CANCELLED("Đã hủy")
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DraftsScreen(
    uiState: QuickImportUiState,
    drafts: List<ImportDraftEntity>,
    returnSummaryLookup: (String) -> ImportReturnSummary,
    onCreateDraft: () -> Unit,
    onOpenDraft: (String) -> Unit,
    onDeleteDraft: (String) -> Unit,
    onOpenImportDetail: (String) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var searchQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf(ImportStatusFilter.ALL) }
    var draftToDelete by remember { mutableStateOf<ImportDraftEntity?>(null) }

    val filteredImports = remember(uiState.imports, searchQuery, statusFilter) {
        val q = searchQuery.trim().lowercase()
        uiState.imports.filter { imp ->
            val statusOk = when (statusFilter) {
                ImportStatusFilter.ALL -> true
                ImportStatusFilter.IMPORTED -> imp.status != "cancelled"
                ImportStatusFilter.CANCELLED -> imp.status == "cancelled"
            }
            if (!statusOk) return@filter false
            if (q.isEmpty()) return@filter true
            imp.code.lowercase().contains(q) ||
                imp.nccName.lowercase().contains(q) ||
                imp.nccCode.lowercase().contains(q) ||
                imp.branch.lowercase().contains(q) ||
                imp.items.any { row ->
                    row.name.lowercase().contains(q) ||
                        row.code.lowercase().contains(q) ||
                        row.imeis.any { im -> im.lowercase().contains(q) }
                }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "NKiot Nhập Hàng",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${uiState.currentUser?.name ?: uiState.savedUsername} • ${uiState.products.size} SP • rev ${uiState.revision}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                ),
                actions = {
                    if (uiState.isSyncing) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .padding(horizontal = 12.dp)
                                .size(20.dp),
                            color = Color.White,
                            strokeWidth = 2.dp
                        )
                    } else {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Default.Refresh, contentDescription = "Đồng bộ")
                        }
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Đăng xuất")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onCreateDraft,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("Tạo phiếu nhập", fontWeight = FontWeight.SemiBold) },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("Phiếu nhập (${uiState.imports.size})", fontWeight = FontWeight.SemiBold) }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("Phiếu nháp (${drafts.size})", fontWeight = FontWeight.SemiBold) }
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
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

                if (selectedTab == 0) {
                    item {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text("Tìm mã PN, NCC, sản phẩm, IMEI...") },
                            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                            trailingIcon = {
                                if (searchQuery.isNotEmpty()) {
                                    IconButton(onClick = { searchQuery = "" }) {
                                        Icon(Icons.Default.Close, contentDescription = "Xóa")
                                    }
                                }
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    item {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ImportStatusFilter.entries.forEach { f ->
                                FilterChip(
                                    selected = statusFilter == f,
                                    onClick = { statusFilter = f },
                                    label = { Text(f.label) }
                                )
                            }
                        }
                    }
                    if (filteredImports.isNotEmpty()) {
                        item {
                            val totalAmount = filteredImports.sumOf { it.needPay }
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "${filteredImports.size} phiếu",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = "Tổng: ${formatVnd(totalAmount)}",
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                    if (filteredImports.isEmpty()) {
                        item {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                            ) {
                                Box(
                                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = "Không có phiếu nhập nào phù hợp.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    } else {
                        items(filteredImports, key = { it.id.ifBlank { it.code } }) { imp ->
                            val retSummary = returnSummaryLookup(imp.code)
                            ImportRowCard(
                                imp = imp,
                                returnedQty = retSummary.totalReturnedQty,
                                onClick = { onOpenImportDetail(imp.code) }
                            )
                        }
                    }
                } else {
                    if (drafts.isEmpty()) {
                        item {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                            ) {
                                Box(
                                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = "Chưa có phiếu nháp nào. Nhấn \"Tạo phiếu nhập\" để bắt đầu quét hàng.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    } else {
                        items(drafts, key = { it.id }) { draft ->
                            DraftCard(
                                draft = draft,
                                onOpen = { onOpenDraft(draft.id) },
                                onDelete = { draftToDelete = draft }
                            )
                        }
                    }
                }
            }
        }

        draftToDelete?.let { draft ->
            AlertDialog(
                onDismissRequest = { draftToDelete = null },
                title = { Text("Xóa phiếu nháp?", fontWeight = FontWeight.Bold) },
                text = {
                    Text("Phiếu nháp '${draft.title}' (${draft.itemCount} sản phẩm, ${draft.totalUnits} cái) sẽ bị xóa vĩnh viễn khỏi thiết bị.")
                },
                confirmButton = {
                    Button(
                        onClick = {
                            onDeleteDraft(draft.id)
                            draftToDelete = null
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = NkiotRed)
                    ) {
                        Text("Xóa nháp")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { draftToDelete = null }) {
                        Text("Giữ lại")
                    }
                }
            )
        }
    }
}

@Composable
private fun DraftCard(
    draft: ImportDraftEntity,
    onOpen: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = if (draft.hasPendingRequest) NkiotAmberBg else MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(44.dp)
            ) {
                Icon(
                    imageVector = if (draft.hasPendingRequest) Icons.Default.WarningAmber else Icons.Default.Description,
                    contentDescription = null,
                    tint = if (draft.hasPendingRequest) NkiotAmber else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(10.dp)
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = draft.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${draft.branchName.ifBlank { "Chưa chọn kho" }} • ${draft.itemCount} mã / ${draft.totalUnits} cái",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = formatVnd(draft.totalAmount),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "• ${formatTimestamp(draft.updatedAt)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (draft.hasPendingRequest) {
                    Text(
                        text = "Chờ kiểm tra kết quả gửi",
                        style = MaterialTheme.typography.labelSmall,
                        color = NkiotAmber,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Default.DeleteOutline,
                    contentDescription = "Xóa nháp",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ImportRowCard(
    imp: ImportRecordDto,
    returnedQty: Int,
    onClick: () -> Unit
) {
    val isCancelled = imp.status == "cancelled"
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = imp.code,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (isCancelled) NkiotRed else MaterialTheme.colorScheme.primary
                    )
                    if (isCancelled) {
                        Surface(color = NkiotRed.copy(alpha = 0.12f), shape = RoundedCornerShape(6.dp)) {
                            Text(
                                text = "Đã hủy",
                                style = MaterialTheme.typography.labelSmall,
                                color = NkiotRed,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    if (returnedQty > 0) {
                        Surface(color = NkiotAmberBg, shape = RoundedCornerShape(6.dp)) {
                            Text(
                                text = "↩ Đã trả $returnedQty",
                                style = MaterialTheme.typography.labelSmall,
                                color = NkiotAmber,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }
                Text(
                    text = formatVnd(imp.needPay),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            Text(
                text = "${imp.nccName.ifBlank { imp.nccCode }} • ${imp.items.size} mã / ${imp.items.sumOf { it.qty }} SP",
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${imp.branch} • ${imp.time.ifBlank { imp.createdAt }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                val debt = (imp.needPay - imp.paid).coerceAtLeast(0L)
                Text(
                    text = if (isCancelled) "Đã hủy" else if (debt > 0) "Nợ ${formatVnd(debt)}" else "Đã trả đủ",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isCancelled) NkiotRed else if (debt > 0) NkiotAmber else NkiotEmerald
                )
            }
        }
    }
}
