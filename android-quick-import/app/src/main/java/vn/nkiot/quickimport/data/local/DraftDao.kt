package vn.nkiot.quickimport.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DraftDao {
    @Query("SELECT * FROM import_drafts ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<ImportDraftEntity>>

    @Query("SELECT * FROM import_drafts WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ImportDraftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: ImportDraftEntity)

    @Query("DELETE FROM import_drafts WHERE id = :id")
    suspend fun deleteById(id: String)
}
