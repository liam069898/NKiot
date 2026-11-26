package vn.nkiot.quickimport.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "import_drafts")
data class ImportDraftEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val branchName: String,
    val supplierName: String,
    val itemCount: Int,
    val totalUnits: Int,
    val totalAmount: Long,
    val hasPendingRequest: Boolean,
    val contentJson: String,
    val updatedAt: Long
)
