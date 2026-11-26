package vn.nkiot.quickimport.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import vn.nkiot.quickimport.data.model.DeviceCondition
import vn.nkiot.quickimport.data.model.DraftImeiDetail
import java.io.File
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ImeiInspectionSheet(
    productName: String,
    imei: String,
    initialDetail: DraftImeiDetail,
    isImeiProduct: Boolean = true,
    onDetailChanged: (DeviceCondition?, String) -> Unit,
    onPhotoAdded: (String) -> Unit = {},
    onPhotosAdded: (List<String>) -> Unit = { paths -> paths.forEach(onPhotoAdded) },
    onPhotoRemoved: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var pendingCameraFile by remember { mutableStateOf<File?>(null) }
    var galleryPreview by remember { mutableStateOf<ImageGalleryState?>(null) }
    var isProcessingPhotos by remember { mutableStateOf(false) }

    val takePictureLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val file = pendingCameraFile
        if (success && file != null && file.exists() && file.length() > 0L) {
            onPhotoAdded(file.absolutePath)
        }
        pendingCameraFile = null
    }

    fun launchCameraCapture() {
        val photoFile = createInspectionPhotoFile(context)
        pendingCameraFile = photoFile
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            photoFile
        )
        takePictureLauncher.launch(uri)
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            launchCameraCapture()
        }
    }

    val pickPhotosLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            scope.launch {
                isProcessingPhotos = true
                val copiedPaths = withContext(Dispatchers.IO) {
                    uris.mapNotNull { uri ->
                        copyUriToInspectionFile(context, uri)?.absolutePath
                    }
                }
                if (copiedPaths.isNotEmpty()) {
                    onPhotosAdded(copiedPaths)
                }
                isProcessingPhotos = false
            }
        }
    }

    fun openGalleryPicker() {
        if (!isProcessingPhotos) {
            pickPhotosLauncher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            )
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = if (isImeiProduct) "Kiểm định & Ảnh máy (IMEI)" else "Hình ảnh & Mô tả sản phẩm",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = if (isImeiProduct) "$productName • IMEI: $imei" else "$productName • Mã SP: $imei",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold
                )
            }

            // 1-Tap Condition Chips
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Tình trạng ngoại quan (chạm để chọn nhanh)", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf(null, "new", "like_new", "good", "fair").forEach { value ->
                        val condition = value?.let(DeviceCondition::fromApi)
                        val isSelected = initialDetail.condition == condition
                        FilterChip(
                            selected = isSelected,
                            onClick = { onDetailChanged(condition, initialDetail.conditionDetail) },
                            label = {
                                Text(
                                    text = inspectionConditionLabel(condition),
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        )
                    }
                }
                OutlinedTextField(
                    value = initialDetail.conditionDetail,
                    onValueChange = { onDetailChanged(initialDetail.condition, it) },
                    label = { Text("Ghi chú kiểm định / Mô tả chi tiết") },
                    placeholder = { Text("VD: Pin 92%, màn đẹp không ám, viền trầy nhẹ góc dưới…") },
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Photos section
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Hình ảnh (${initialDetail.photos.size} ảnh)",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Chọn nhiều ảnh cùng lúc",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium
                )
            }

            if (isProcessingPhotos) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text(
                        text = "Đang sao chép ảnh từ thư viện...",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                        if (granted) {
                            launchCameraCapture()
                        } else {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    },
                    enabled = !isProcessingPhotos,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(1f).height(46.dp)
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Chụp ảnh", fontWeight = FontWeight.SemiBold)
                }

                OutlinedButton(
                    onClick = { openGalleryPicker() },
                    enabled = !isProcessingPhotos,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.weight(1f).height(46.dp)
                ) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Chọn nhiều ảnh", fontWeight = FontWeight.SemiBold)
                }
            }

            if (initialDetail.photos.isEmpty()) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                        .clickable(enabled = !isProcessingPhotos) { openGalleryPicker() }
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 18.dp, horizontal = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.AddPhotoAlternate,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(28.dp)
                        )
                        Text(
                            text = "Chưa có ảnh kiểm định",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Chạm vào đây để chọn nhiều ảnh từ thư viện hoặc bấm Chụp ảnh",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                val allPaths = remember(initialDetail.photos) { initialDetail.photos.map { it.localPath } }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    itemsIndexed(initialDetail.photos, key = { _, it -> it.localPath }) { idx, photo ->
                        Box(modifier = Modifier.size(100.dp)) {
                            AsyncImage(
                                model = File(photo.localPath),
                                contentDescription = "Ảnh ${idx + 1}",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .size(100.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable {
                                        galleryPreview = ImageGalleryState(
                                            images = allPaths,
                                            initialIndex = idx
                                        )
                                    }
                            )
                            // Index pill bottom-left
                            Surface(
                                color = Color.Black.copy(alpha = 0.6f),
                                shape = RoundedCornerShape(6.dp),
                                modifier = Modifier
                                    .align(Alignment.BottomStart)
                                    .padding(6.dp)
                            ) {
                                Text(
                                    text = "#${idx + 1}",
                                    color = Color.White,
                                    style = MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                )
                            }
                            // Compact delete button top-right (doesn't cover photo center)
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(4.dp)
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(Color.Black.copy(alpha = 0.72f))
                                    .clickable { onPhotoRemoved(photo.localPath) },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Xóa ảnh",
                                    tint = Color.White,
                                    modifier = Modifier.size(15.dp)
                                )
                            }
                        }
                    }

                    // Trailing "+ Thêm ảnh" tile
                    item {
                        Box(
                            modifier = Modifier
                                .size(100.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f))
                                .clickable(enabled = !isProcessingPhotos) { openGalleryPicker() },
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.AddPhotoAlternate,
                                    contentDescription = "Thêm ảnh",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(24.dp)
                                )
                                Text(
                                    text = "+ Thêm ảnh",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = onDismiss,
                enabled = !isProcessingPhotos,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Text("Xong (${initialDetail.photos.size} ảnh)", fontWeight = FontWeight.Bold)
            }
        }
    }

    if (galleryPreview != null) {
        FullscreenImageViewer(
            imageModel = galleryPreview,
            onDismiss = { galleryPreview = null }
        )
    }
}

// Match the current web import form, including the uninspected (null) state.
internal fun inspectionConditionLabel(condition: DeviceCondition?): String = when (condition) {
    null -> "Chưa kiểm định"
    DeviceCondition.fromApi("new") -> "Mới"
    DeviceCondition.fromApi("like_new") -> "Như mới"
    DeviceCondition.fromApi("good") -> "Tốt"
    DeviceCondition.fromApi("fair") -> "Khá"
    else -> condition.label
}

private fun createInspectionPhotoFile(context: Context): File {
    val dir = File(context.filesDir, "inspection_photos").apply { mkdirs() }
    return File(dir, "inspect_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}.jpg")
}

private fun copyUriToInspectionFile(context: Context, uri: Uri): File? {
    return runCatching {
        val target = createInspectionPhotoFile(context)
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
        if (target.exists() && target.length() > 0L) target else null
    }.getOrNull()
}
