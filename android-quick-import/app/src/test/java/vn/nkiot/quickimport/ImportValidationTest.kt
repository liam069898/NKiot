package vn.nkiot.quickimport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import vn.nkiot.quickimport.data.model.DeviceCondition
import vn.nkiot.quickimport.data.model.DraftContent
import vn.nkiot.quickimport.data.model.DraftImeiDetail
import vn.nkiot.quickimport.data.model.DraftItem
import vn.nkiot.quickimport.data.model.DraftPhoto
import vn.nkiot.quickimport.data.model.PaymentMethod
import vn.nkiot.quickimport.data.model.PaymentMode
import vn.nkiot.quickimport.data.repository.QuickImportRepository

class ImportValidationTest {

    @Test
    fun buildCommandEnvelope_matchesNkiotContract() {
        val draft = DraftContent(
            branchName = "Kalo HCM",
            supplierCode = "NCC000001",
            supplierName = "An Tiến",
            items = listOf(
                DraftItem(
                    productCode = "SP001",
                    productName = "Garmin MarQ II",
                    hasImei = true,
                    qty = 2,
                    unitPrice = 4_500_000L,
                    imeis = listOf("GM001", "GM002"),
                    imeiDetails = mapOf(
                        "GM001" to DraftImeiDetail(
                            condition = DeviceCondition.LIKE_NEW,
                            conditionDetail = "Pin 98%, zin áp",
                            photos = listOf(DraftPhoto("/local/1.jpg", "/uploads/1.jpg"))
                        )
                    )
                )
            ),
            paymentMode = PaymentMode.PARTIAL,
            partialPaidAmount = 5_000_000L,
            paymentMethod = PaymentMethod.TRANSFER,
            note = "Đợt nhập sáng"
        )

        assertNull(QuickImportRepository.validateDraftForSubmit(draft))
        assertEquals(9_000_000L, draft.totalAmount)
        assertEquals(5_000_000L, draft.paidAmount)
        assertEquals(4_000_000L, draft.remainingDebt)

        val envelope = QuickImportRepository.buildCommandEnvelope("and-1234567890123456", 42L, draft)
        assertEquals("import", envelope.type)
        assertEquals(42L, envelope.revision)
        assertEquals("Kalo HCM", envelope.payload.branch)
        assertEquals("NCC000001", envelope.payload.supplierCode)
        assertEquals(5_000_000L, envelope.payload.paid)
        assertEquals("transfer", envelope.payload.paymentMethod)
        assertEquals(1, envelope.payload.items.size)
        assertEquals(2, envelope.payload.items[0].qty)
        assertEquals("like_new", envelope.payload.items[0].imeiDetails["GM001"]?.condition)
        assertEquals(listOf("/uploads/1.jpg"), envelope.payload.items[0].imeiDetails["GM001"]?.images)
    }

    @Test
    fun photoOnlyDevices_roundTripDraftAndKeepPhotosSeparate() {
        val draft = DraftContent(
            branchName = "Chi nhánh thử nghiệm",
            supplierCode = "NCC_TEST",
            items = listOf(DraftItem(
                productCode = "PHONE_TEST",
                productName = "Máy cũ",
                hasImei = true,
                unitPrice = 2_000_000L,
                imeis = listOf("IMEI_A", "IMEI_B"),
                imeiDetails = mapOf(
                    "IMEI_A" to DraftImeiDetail(photos = listOf(DraftPhoto("/a.jpg", "/uploads/a.jpg"))),
                    "IMEI_B" to DraftImeiDetail(photos = listOf(DraftPhoto("/b.jpg", "/uploads/b.jpg")))
                )
            ))
        )
        val json = kotlinx.serialization.json.Json
        val restored = json.decodeFromString(DraftContent.serializer(), json.encodeToString(DraftContent.serializer(), draft))
        assertEquals(draft, restored)
        assertNull(QuickImportRepository.validateDraftForSubmit(restored))
        val payload = QuickImportRepository.buildCommandEnvelope("test", 1L, restored).payload
        assertEquals(0L, payload.paid)
        assertEquals(2_000_000L, payload.items.single().price)
        assertEquals(2, payload.items.single().qty)
        val details = payload.items.single().imeiDetails
        assertEquals(listOf("/uploads/a.jpg"), details["IMEI_A"]?.images)
        assertEquals(listOf("/uploads/b.jpg"), details["IMEI_B"]?.images)
        assertNull(details["IMEI_A"]?.condition)
    }

    @Test
    fun inspection_roundTripsAndMapsPerImeiWithoutReplacingPhotos() {
        val photo = DraftPhoto("/local/device.jpg", "/uploads/device.jpg")
        val photoOnly = DraftImeiDetail(photos = listOf(photo))
        val descriptions = listOf("Pin 98%, ngoại hình đẹp", "Trầy viền, đã thay pin", "", "Máy cũ")
        val conditions = listOf("new", "like_new", "good", "fair")
        val details = conditions.mapIndexed { index, api ->
            "IMEI_$index" to photoOnly.copy(
                condition = DeviceCondition.fromApi(api),
                conditionDetail = descriptions[index]
            )
        }.toMap() + ("PHOTO_ONLY" to photoOnly)
        val draft = DraftContent(
            branchName = "Kho thử nghiệm",
            supplierCode = "TEST",
            items = listOf(DraftItem(
                productCode = "PHONE", productName = "Máy cũ", hasImei = true,
                imeis = details.keys.toList(), imeiDetails = details
            ))
        )
        val json = kotlinx.serialization.json.Json
        val restored = json.decodeFromString(DraftContent.serializer(), json.encodeToString(DraftContent.serializer(), draft))
        assertEquals(draft, restored)
        val mapped = QuickImportRepository.buildCommandEnvelope("test", 1L, restored).payload.items.single().imeiDetails
        conditions.forEachIndexed { index, api ->
            assertEquals(api, mapped["IMEI_$index"]?.condition)
            assertEquals(descriptions[index], mapped["IMEI_$index"]?.conditionDetail)
            assertEquals(listOf("/uploads/device.jpg"), mapped["IMEI_$index"]?.images)
        }
        assertNull(mapped["PHOTO_ONLY"]?.condition)
        assertEquals(listOf("/uploads/device.jpg"), mapped["PHOTO_ONLY"]?.images)
        val cleared = details.getValue("IMEI_0").copy(condition = null, conditionDetail = "")
        assertEquals(photoOnly, cleared)
    }

    @Test
    fun validateDraft_rejectsDuplicateImeis() {
        val draft = DraftContent(
            branchName = "Kalo HCM",
            supplierCode = "NCC000001",
            items = listOf(
                DraftItem(
                    productCode = "SP001",
                    productName = "Garmin",
                    hasImei = true,
                    imeis = listOf("IMEI001", "IMEI001"),
                    unitPrice = 1_000_000L
                )
            )
        )
        assertNotNull(QuickImportRepository.validateDraftForSubmit(draft))
    }

    @Test
    fun generateNextCode_and_parseBulkImeis_workAsExpected() {
        assertEquals(
            "NCC000010",
            QuickImportRepository.generateNextCode(listOf("NCC000001", "NCC000009"), "NCC", 6)
        )
        assertEquals(
            "SP006",
            QuickImportRepository.generateNextCode(listOf("SP001", "SP005"), "SP", 3)
        )
        assertEquals(
            listOf("IM001", "IM002", "IM003"),
            QuickImportRepository.parseBulkImeis("IM001, IM002\nIM003; IM001 ")
        )
    }
}
