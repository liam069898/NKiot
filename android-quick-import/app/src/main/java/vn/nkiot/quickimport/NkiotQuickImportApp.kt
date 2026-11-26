package vn.nkiot.quickimport

import android.app.Application
import vn.nkiot.quickimport.data.local.AppDatabase
import vn.nkiot.quickimport.data.remote.NkiotApiClient
import vn.nkiot.quickimport.data.remote.SessionStore
import vn.nkiot.quickimport.data.repository.QuickImportRepository

class NkiotQuickImportApp : Application() {
    lateinit var repository: QuickImportRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val sessionStore = SessionStore(this)
        val apiClient = NkiotApiClient(sessionStore)
        val database = AppDatabase.getInstance(this)
        repository = QuickImportRepository(
            api = apiClient,
            sessionStore = sessionStore,
            draftDao = database.draftDao()
        )
    }
}
