package vn.nkiot.quickimport.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.request.ImageRequest
import java.io.File

data class ImageGalleryState(
    val images: List<String>,
    val initialIndex: Int = 0
)

@Composable
fun FullscreenImageViewer(
    imageModel: Any?,
    cookieHeader: String? = null,
    onDismiss: () -> Unit
) {
    if (imageModel == null) return
    val gallery = when (imageModel) {
        is ImageGalleryState -> imageModel
        is List<*> -> {
            val list = imageModel.filterIsInstance<String>()
            if (list.isEmpty()) return
            ImageGalleryState(list, 0)
        }
        is String -> ImageGalleryState(listOf(imageModel), 0)
        is File -> ImageGalleryState(listOf(imageModel.absolutePath), 0)
        else -> ImageGalleryState(listOf(imageModel.toString()), 0)
    }
    FullscreenGalleryViewer(
        images = gallery.images,
        initialIndex = gallery.initialIndex,
        cookieHeader = cookieHeader,
        onDismiss = onDismiss
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FullscreenGalleryViewer(
    images: List<String>,
    initialIndex: Int = 0,
    cookieHeader: String? = null,
    onDismiss: () -> Unit
) {
    if (images.isEmpty()) return
    val safeInitial = initialIndex.coerceIn(0, images.lastIndex)
    val pagerState = rememberPagerState(
        initialPage = safeInitial,
        pageCount = { images.size }
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.95f))
        ) {
            var currentPageZoomed by remember { mutableStateOf(false) }

            HorizontalPager(
                state = pagerState,
                userScrollEnabled = !currentPageZoomed,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                ZoomablePhotoPage(
                    rawPathOrUrl = images[page],
                    cookieHeader = cookieHeader,
                    isCurrentPage = pagerState.currentPage == page,
                    onZoomChanged = { zoomed ->
                        if (pagerState.currentPage == page) {
                            currentPageZoomed = zoomed
                        }
                    }
                )
            }

            // Top bar: Counter badge + Close button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .padding(horizontal = 20.dp, vertical = 24.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = Color.Black.copy(alpha = 0.6f),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Text(
                        text = "${pagerState.currentPage + 1} / ${images.size} • Chạm đúp để phóng to",
                        color = Color.White,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }

                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .size(44.dp)
                        .background(Color.White.copy(alpha = 0.22f), CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Đóng",
                        tint = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun ZoomablePhotoPage(
    rawPathOrUrl: String,
    cookieHeader: String?,
    isCurrentPage: Boolean,
    onZoomChanged: (Boolean) -> Unit
) {
    val context = LocalContext.current
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    LaunchedEffect(isCurrentPage) {
        if (!isCurrentPage) {
            scale = 1f
            offset = Offset.Zero
            onZoomChanged(false)
        }
    }

    val model = remember(rawPathOrUrl, cookieHeader) {
        if (rawPathOrUrl.startsWith("http://") || rawPathOrUrl.startsWith("https://")) {
            ImageRequest.Builder(context)
                .data(rawPathOrUrl)
                .apply { if (cookieHeader != null) addHeader("Cookie", cookieHeader) }
                .crossfade(true)
                .build()
        } else {
            File(rawPathOrUrl)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(rawPathOrUrl) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.05f) {
                            scale = 1f
                            offset = Offset.Zero
                            onZoomChanged(false)
                        } else {
                            scale = 2.5f
                            onZoomChanged(true)
                        }
                    }
                )
            }
            .pointerInput(rawPathOrUrl) {
                detectTransformGestures { _, pan, zoom, _ ->
                    val newScale = (scale * zoom).coerceIn(1f, 4f)
                    scale = newScale
                    if (newScale > 1.02f) {
                        val maxX = (size.width * (newScale - 1f)) / 2f
                        val maxY = (size.height * (newScale - 1f)) / 2f
                        offset = Offset(
                            x = (offset.x + pan.x).coerceIn(-maxX, maxX),
                            y = (offset.y + pan.y).coerceIn(-maxY, maxY)
                        )
                        onZoomChanged(true)
                    } else {
                        offset = Offset.Zero
                        onZoomChanged(false)
                    }
                }
            },
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = model,
            contentDescription = "Ảnh kiểm định phóng to",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .padding(8.dp)
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y
                )
        )
    }
}
