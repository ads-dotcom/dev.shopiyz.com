# Native müşteri segmentleri API'si

`/admin/api/v1/customer_segments/native…` uçları mevcut `/api/customer-segments` yönetim ekranının Native tanım, revision, hesaplama, üyelik ve kitle yardımcılarını kullanır. Aynı `customer_segment_definitions`, `customer_segment_revisions`, `customer_segment_jobs`, nesil üyelikleri ve aktöre bağlı audience kayıtları okunur/yazılır. Eski `/customer_segments.json` ve `/customer_segments/{id}.json` kayıt tabanlı uyumluluk uçları ayrı kalır; yeni Native bir segment o kayıt koleksiyonuna kopyalanmaz.

[Şema ve operation eşlemesi](customer-segments-native-schemas.json), gerçek Native alan/operator tanımlarından üretilir. Bu dosya canonical OpenAPI'ye eklenmek üzere 28 operation ve request/response şemalarını içerir. `node scripts/generate-native-customer-segment-contract.mjs --check` kaynak hash ve şema eşleşmesini denetler.

## Yetki ve hazırlık

Okuma için `customers:read`, `customers:write`, `admin:read` veya `admin:write`; mutasyon için `customers:write` veya `admin:write` gerekir. API tokenının gerçek `created_by_user_id` kullanıcısı her istekte güncel Native üyelik, rol ve mağaza erişimiyle doğrulanır. Cookie, body/header aktör veya başka mağaza kimliği bu yetkiyi değiştirmez. Scope tek başına Native kullanıcı izni oluşturmaz.

- Görüntüleme: `customers:manage` veya `customers:segments_view`.
- Tanım kaydetme, hesaplama ve lifecycle: `customers:manage`.
- Kitle hazırlama/okuma/devam: `customers:manage` veya `customers:segments_use`, ayrıca görüntüleme izni.
- Kitle üyeleri/CSV: `customers:export`, ayrıca görüntüleme izni ve orijinal kitle sahibi.
- Segment üyeleri yönetim izni olmayan okuyucuya `name: "Müşteri"`, `email: "•••"` ile maskelenir. Custom-field kataloğu yönetim izni yoksa `available:false,fields:[]` döner.

Bu namespace ortak Admin response cache'ini kullanmaz. Sonraki istekte rol/üyelik iptali hemen uygulanır. Daha önce tamamlanmış bir yazmanın idempotent yanıtı dönmeden önce de güncel Native rol, mağaza ve işlem izni yeniden doğrulanır; saklanan PII preview yanıtı eski yetkiyle geri verilemez. Native segment migration makbuzu yoksa `409 release_not_ready` döner; API segment DDL kurmaz veya migration yapmaz.

## Tanım ve lifecycle

Bütün yollar aşağıdaki tabloda `/admin/api/v1/customer_segments/native` ile başlar. Yazmalar `Idempotency-Key` ve JSON gövde kullanır; DELETE de `expectedRevision` gövdesi ister.

| Method ve suffix                                                   | Native sonuç                                                                                      | Başarı |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------ |
| GET `.json`                                                        | `segments`, `nextCursor`; `search`, `status`, `cursor` filtreleri                                 | 200    |
| POST `.json`                                                       | `{title,description?,definition,creationKey?}` ile gerçek taslak; `{segment}`                     | 201    |
| GET `/{segment_id}.json`                                           | `{segment,canContinue}`                                                                           | 200    |
| PATCH `/{segment_id}.json`                                         | Tam `title`, `definition`, `expectedRevision`, isteğe bağlı description; aynı ID'de yeni revision | 200    |
| DELETE `/{segment_id}.json` veya POST `/{segment_id}/archive.json` | `{expectedRevision}` ile Native arşiv; geçmiş/müşteriler silinmez                                 | 200    |
| POST `/{segment_id}/{preview,activate,recalculate}.json`           | `{expectedRevision}`; `{job,segment,canContinue:true}`                                            | 202    |
| POST `/{segment_id}/continue.json`                                 | Aynı revision için yalnız bir sınırlı Native adım; `{segment,canContinue:true}`                   | 200    |
| POST `/{segment_id}/{pause,resume}.json`                           | `{expectedRevision}`; gerçek işi duraklatır/sürdürür                                              | 200    |
| GET `/{segment_id}/members.json`                                   | Tamamlanmış `generation`, maskeli/yetkili `customers`, `nextCursor`                               | 200    |
| GET `/{segment_id}/activity.json`                                  | Native revisions, campaigns, flows; cursor                                                        | 200    |
| GET `/{segment_id}/explanation.json?customerId=…`                  | Gerçek müşteri için true/false/unknown açıklama ve kaynak kapsamı                                 | 200    |
| GET `/templates.json`, `/custom_fields.json`                       | Native şablon/kaynak kapsamı veya kullanılabilir özel alanlar                                     | 200    |
| POST `/validate.json`                                              | `{definition}`; Native DSL doğrulaması                                                            | 200    |
| GET `/customers/{customer_id}.json`                                | O mağazadaki müşterinin hazır segmentleri ve 30 günlük Native davranış özeti                      | 200    |

Oluşturmada `creationKey` verilmezse özgün writer token ve `Idempotency-Key` üzerinden sabit bir Native oluşturma anahtarı üretilir. D1 commit cevabı kaybolduğunda aynı tanım bulunur; ikinci segment açılmaz. Güncelleme revision CAS kullanır. Başka path ID'sini body `id` ile seçmek `409`, eski revision `409` döner. Sonucun belirsiz olduğu bir isteği farklı anahtarla yeniden başlatmayın; kaydı ve revision geçmişini okuyun.

`202` tamamlanmış üyelik veya aktif kitle demek değildir. `preview` işi tamamlandığında segment `draft` kalır. `activate`/`recalculate` işi tamamlandıktan sonra `ready` ve güncel revision/generation birlikte doğrulanır. `count`, `unknownCount`, `reachableEmail` yalnız güncel ready revision için sayıdır; hesaplama sürerken null olabilir. `lastCompleted` tarihsel bilgi olup güncel kitle yetkisi değildir. `continue` başka mağazanın veya segmentin işini çalıştırmaz.

Üyelik sayfalamasında ilk dönen `generation` değerini sonraki `cursor` ile aynen taşıyın. Cursor Native HMAC ile mağaza, aktör, sorgu/PII kapsamı ve süreye bağlıdır. Actor/filtre/generation değiştirildiğinde yeniden başlayın; başka okuyucunun cursor'ını benimsemeyin. `unknown` eksik kaynak/izin kapsamını ifade eder; istemci bunu false veya sıfır olarak dönüştürmemelidir.

## Eski kategori ve aktöre bağlı kitle

| Method ve suffix                              | Native sonuç                                                                            | Başarı                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------- |
| GET `/legacy.json`                            | Eski kategorilerin Native listesi; `offset`, `type`                                     | 200                       |
| POST `/legacy/preview.json`                   | `{rules}`; Native legacy derleyici ile count ve en çok 12 müşteri; yönetim izni gerekli | 200                       |
| GET `/legacy/{legacy_id}/review.json`         | `compatible`, `manual_preserved`, `already_current` veya `review_required`              | 200                       |
| POST `/legacy/{legacy_id}/upgrade.json`       | `{expectedUpdatedAt}`; review'nin ham updatedAt değerini aynen kullanır                 | 200 veya 202              |
| POST `/audiences.json`                        | `{ids:[…]}`: 1–20 farklı mevcut hazır kategori/segment; `{id,status:"preparing"}`       | 202                       |
| GET `/audiences/{audience_id}.json`           | Gerçek sahibine `{id,status,count}`; count yalnız ready iken sayı                       | 200                       |
| POST `/audiences/{audience_id}/continue.json` | JSON `{}`; aynı kitle için bir Native sayfa                                             | 200 ready, aksi halde 202 |
| GET `/audiences/{audience_id}/members.json`   | Orijinal sahibi ve export yetkisiyle cursor sayfalı müşteri ID/e-posta                  | 200                       |
| GET `/audiences/{audience_id}/export.json`    | `{export:{content_type,file_name,content}}`: gerçek Native CSV                          | 200                       |

Legacy upgrade yalnız o mağaza/kategori için sınırlı devam işlemi planlar; API çağrısı tüm mağazaların segmentlerini boşaltmaz. Manual kategoriler korunur; uyumsuz kurallar başarılı yükseltme olarak sunulmaz.

Kitle orijinal aktöre, mağazaya ve Native kategori/revision/generation kapsamına bağlıdır. Başka aktör aynı mağazada olsa bile bu kitle ID'sini devralamaz. Kaynak segmentin değişmesi/arşivlenmesi veya davranış izninin sona ermesi Native okuma/alıcılama kurallarında yeniden değerlendirilir. Export yeni bir kampanya veya iş makbuzu uydurmaz; Native CSV'nin tamamı en fazla 512 KiB ise JSON içinde döner. Daha büyük çıktı `413` ile reddedilir, başarılı kesilmiş çıktı verilmez; daha büyük kitleyi `/members.json` cursor sayfalarıyla okuyun. Native CSV formül kaçışını korur.

Bu entegrasyon müşteri/sipariş/stok restore işlemi değildir. Katalog veya içerik geri alması için tüm veri tabanı yedeğini uygulamayın; daha sonra oluşan sipariş ve envanter hareketleri korunmalıdır. Yerel HTTP/SQLite testleri canlı yayın veya mağaza aktivasyonu sayılmaz.
