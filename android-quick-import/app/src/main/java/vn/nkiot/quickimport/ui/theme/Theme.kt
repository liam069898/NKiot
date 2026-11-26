package vn.nkiot.quickimport.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val NkiotBlue = Color(0xFF0066CC)
val NkiotBlueDark = Color(0xFF004C99)
val NkiotBlueLight = Color(0xFFE6F0FA)
val NkiotEmerald = Color(0xFF059669)
val NkiotEmeraldBg = Color(0xFFECFDF5)
val NkiotAmber = Color(0xFFD97706)
val NkiotAmberBg = Color(0xFFFFFBEB)
val NkiotRed = Color(0xFFDC2626)
val NkiotSlate = Color(0xFF0F172A)
val NkiotMuted = Color(0xFF64748B)
val NkiotSurfaceBg = Color(0xFFF8FAFC)

private val LightColors = lightColorScheme(
    primary = NkiotBlue,
    onPrimary = Color.White,
    primaryContainer = NkiotBlueLight,
    onPrimaryContainer = NkiotBlueDark,
    secondary = NkiotEmerald,
    onSecondary = Color.White,
    secondaryContainer = NkiotEmeraldBg,
    onSecondaryContainer = Color(0xFF065F46),
    error = NkiotRed,
    onError = Color.White,
    background = NkiotSurfaceBg,
    onBackground = NkiotSlate,
    surface = Color.White,
    onSurface = NkiotSlate,
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = NkiotMuted,
    outline = Color(0xFFCBD5E1)
)

@Composable
fun NkiotQuickImportTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        content = content
    )
}
