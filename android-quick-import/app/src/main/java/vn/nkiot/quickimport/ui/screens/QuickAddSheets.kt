package vn.nkiot.quickimport.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.unit.dp
import vn.nkiot.quickimport.data.model.CategoryDto
import vn.nkiot.quickimport.ui.util.formatVnd
import vn.nkiot.quickimport.ui.viewmodel.BulkImeiResult

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickAddSupplierSheet(
    isSubmitting: Boolean,
    onCreate: (name: String, phone: String, address: String) -> Unit,
    onDismiss: () -> Unit
) {
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Thêm nhanh nhà cung cấp",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Tên nhà cung cấp *") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text("Số điện thoại") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("Địa chỉ") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = { onCreate(name, phone, address) },
                enabled = !isSubmitting && name.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Lưu & chọn nhà cung cấp", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun QuickAddProductSheet(
    categories: List<CategoryDto>,
    isSubmitting: Boolean,
    onCreate: (
        name: String,
        customCode: String,
        barcode: String,
        category: String,
        unit: String,
        costPrice: Long,
        sellPrice: Long,
        hasImei: Boolean
    ) -> Unit,
    onDismiss: () -> Unit
) {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var barcode by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(categories.firstOrNull()?.name ?: "") }
    var unit by remember { mutableStateOf("Chiếc") }
    var costText by remember { mutableStateOf("") }
    var sellText by remember { mutableStateOf("") }
    var hasImei by remember { mutableStateOf(false) }

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
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "Thêm nhanh sản phẩm mới",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Tên sản phẩm *") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Mã SKU (trống = tự sinh)") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = unit,
                    onValueChange = { unit = it },
                    label = { Text("Đơn vị") },
                    singleLine = true,
                    modifier = Modifier.weight(0.7f)
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = barcode,
                    onValueChange = { barcode = it },
                    label = { Text("Mã vạch") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("Nhóm hàng") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
            }

            if (categories.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    categories.take(8).forEach { cat ->
                        FilterChip(
                            selected = category.equals(cat.name, ignoreCase = true),
                            onClick = { category = cat.name },
                            label = { Text(cat.name, style = MaterialTheme.typography.labelSmall) }
                        )
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = costText,
                    onValueChange = { costText = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Giá vốn nhập") },
                    supportingText = {
                        val v = costText.toLongOrNull() ?: 0L
                        Text(formatVnd(v), style = MaterialTheme.typography.labelSmall)
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = sellText,
                    onValueChange = { sellText = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Giá bán") },
                    supportingText = {
                        val v = sellText.toLongOrNull() ?: 0L
                        Text(formatVnd(v), style = MaterialTheme.typography.labelSmall)
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Quản lý theo IMEI / Serial", fontWeight = FontWeight.SemiBold)
                    Text(
                        text = "Bật cho đồng hồ, điện thoại, máy tính bảng...",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(checked = hasImei, onCheckedChange = { hasImei = it })
            }

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {
                    onCreate(
                        name,
                        code,
                        barcode,
                        category,
                        unit,
                        costText.toLongOrNull() ?: 0L,
                        sellText.toLongOrNull() ?: 0L,
                        hasImei
                    )
                },
                enabled = !isSubmitting && name.isNotBlank(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("Tạo & thêm vào phiếu", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun BulkImeiPasteDialog(
    productName: String,
    onApply: (String) -> BulkImeiResult,
    onDismiss: () -> Unit
) {
    var rawText by remember { mutableStateOf("") }
    var lastResult by remember { mutableStateOf<BulkImeiResult?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Dán hàng loạt IMEI / Serial", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = productName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = rawText,
                    onValueChange = { rawText = it },
                    placeholder = { Text("Mỗi dòng 1 IMEI, hoặc cách nhau bằng dấu phẩy / khoảng trắng...") },
                    minLines = 5,
                    maxLines = 8,
                    modifier = Modifier.fillMaxWidth()
                )
                lastResult?.let { res ->
                    Text(
                        text = "Đã thêm: ${res.addedCount} • Trùng trong phiếu: ${res.duplicateInDraft} • Đã có trong kho: ${res.existsInSystem}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val res = onApply(rawText)
                    lastResult = res
                    if (res.addedCount > 0 && res.duplicateInDraft == 0 && res.existsInSystem == 0) {
                        onDismiss()
                    }
                },
                enabled = rawText.isNotBlank()
            ) {
                Text("Thêm IMEI")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Đóng") }
        }
    )
}
