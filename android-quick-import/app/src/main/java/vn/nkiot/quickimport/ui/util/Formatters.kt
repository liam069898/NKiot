package vn.nkiot.quickimport.ui.util

import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val viLocale = Locale("vi", "VN")
private val numberFormatter: NumberFormat
    get() = NumberFormat.getNumberInstance(viLocale)

fun formatVnd(amount: Long): String = "${numberFormatter.format(amount)} ₫"

fun formatNumber(value: Long): String = numberFormatter.format(value)

fun formatTimestamp(millis: Long): String {
    val sdf = SimpleDateFormat("HH:mm dd/MM/yyyy", viLocale)
    return sdf.format(Date(millis))
}
