# Storefront Account API v2

Bu sözleşme mevcut Native müşteri hesabı servisini belgeler. Mağazanın kendi origin'inde `GET /api/storefront/v2/account/openapi.json` güncel OpenAPI 3.1 belgesini sunar. `HEAD` yalnız bu statik belge için desteklenir; belge okuması oturum açmaz, veri tabanına veya sağlayıcıya gitmez. Kaynak kopya [storefront-account-v2-openapi.yaml](storefront-account-v2-openapi.yaml) dosyasıdır. V1 sözleşmesi ayrı kalır.

Katalog doğrudan `handleAccountV2Request` ve ortak giriş dispatcher AST'sinden üretilir. 71 kabul edilen Native methodun 70'i canonical olarak belgelenir. `POST /gift-registries/{registryId}` mevcut bir alias'tır, fakat handler path ID'sini kullanmaz; güncellenen kayıt JSON `id` alanından ve doğrulanmış sahibinden belirlenir. Yeni istemciler `POST /gift-registries` kullanır. Kaynak SHA-256 değerleri OpenAPI'de yer alır; method veya route değişikliği yeniden üretim kontrolünü geçmeden yayımlanamaz.

## Kimlik ve erişim

| İşlem ailesi                                                                      | Kimlik                                         | Kapsam ve ek koşul                                                                                                                                        |
| --------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hesap ana görünümü ve `/entry`                                                    | Müşteri oturumu isteğe bağlı                   | Anonim görünüm özel müşteri verisi içermez. OAuth veya cross-origin istendiğinde Native müşteri doğrulaması uygulanır.                                    |
| `/config`, giriş/challenge işlemleri                                              | Mevcut müşteri girişi gerekmez                 | Native özellik ayarı; aynı-origin izinli giriş veya izinli Storefront client. Login/challenge yazmaları `customer:write`, config `storefront:read` ister. |
| Profil, adres, sipariş/belge, favori, bildirim, hediye listesi ve oturum yönetimi | Native cookie veya müşteri OAuth access tokenı | GET `customer:read`; mutasyon `customer:write`. Kayıtlar gerçek mağaza ve doğrulanmış müşteri sahibine bağlıdır.                                          |
| Buyer context, B2B portal, davet kabulü                                           | Native müşteri cookie/session                  | OAuth tek başına `409` verir. Şirket/şube/katalog ve işlem rolü ayrıca doğrulanır.                                                                        |
| GET davet önizlemesi                                                              | Özel davet tokenı                              | Storefront `customer:read`; henüz giriş yapılmış müşteri gerekmez. Kabul işlemi Native oturum ve doğrulanmış müşteri e-postası ister.                     |
| `/shared/profile`                                                                 | Orijinal ortak hesap Native oturumu            | Müşteri OAuth tokenı ortak hesap kanıtı değildir.                                                                                                         |
| Ortak giriş `/auth/central/start` ve `/callback`                                  | Native flow cookie ve tek kullanımlık değerler | Start POST, callback GET; başka method ve HEAD tüketim yapmaz.                                                                                            |

Native cookie adı uyumluluk nedeniyle `faprika_customer_session` olarak kalır; bu ad bir supplier çağrısı anlamına gelmez. Cookie kullanan tarayıcı akışı aynı origin'dedir. Harici müşteri OAuth için mevcut V1 authorization-code/PKCE uçları kullanılır. Cross-origin müşteri isteğinde OAuth tokenına ek olarak aynı client'a ait Storefront tokenı ve izinli `Origin` gerekir. Storefront client tokenı tek başına müşteri sahibi seçmez.

`X-Shopiyz-Expected-Customer` yalnız eski sekme için önkoşuldur: gerçek oturum başka müşteriye geçtiyse `409` döner. Kimlik doğrulama veya başka bir müşteri seçme yetkisi değildir. Kayıtlı ve izinli origin için preflight bu header'ı ve `Idempotency-Key` header'ını listeler. Müşteri OAuth ve aynı client/scope/origin kontrolleri yine zorunludur. Credentialed cookie CORS ilan edilmez. Cross-origin B2B cookie entegrasyonu varmış gibi varsayılmamalıdır.

## Mutasyon, gizlilik ve tekrar deneme

Profil PATCH yalnız belgelenen kişisel alanları kabul eder; `customerId`, e-posta, para/bakiye veya yetki alanlarıyla sahiplik değiştirilemez. E-posta değişikliği ayrı challenge ve doğrulama işlemidir. Adres ID'si, sipariş ID'si, şirket seçimi veya oturum referansı başka sahibin kaydına erişim sağlamaz. PDF indirme, hazırlanmış belgeyi döndürmeden önce güncel müşteri ve B2B belge yetkisini yeniden doğrular.

`GET /sessions` opaque müşteri-sahipli referanslar döndürür; session/bearer tokenı, token hash veya parola hash döndürmez. DELETE bu referansı yine mevcut sahibin oturumları içinde çözer. `DELETE /profile`, JSON `confirmation: "HESABIMI SİL"` ister. Native kişisel veri silme işlemi sipariş, fatura, ödeme ve hukuki kayıtları saklar; bütün veri tabanını geri alma veya silme işlemi değildir.

Native revision ve işlem anahtarı kurallarını izleyin. B2B workspaces ve teklif counter işlemleri `requestId`/`expectedRevision`, cart apply `requestId` veya mevcut header anahtarı ve `expectedCartRevision`, hediye listeleri `operationKey`/`expectedRevision` kullanır. Kimlik veya revizyon çatışmasında güncel kaydı okuyun; farklı işlem anahtarı uydurarak aynı işi tekrar başlatmayın. Quote accept/reject ayrıca orijinal tek kullanımlık tokenı ister. Ödeme linki hazırlamak ödeme alındığı anlamına gelmez; finansal gerçek Native ödeme akışında kalır.

Yanıtlar genişletilebilir; ayrıntılı B2B quote/document/pricing alanları Native alt servisin mevcut sonucudur. Native alan doğrulaması, özellik politikası, rol ve sahiplik izinleri her çağrıda uygulanır. Belgede bir route bulunması mağazada o özelliğin açık olduğunu göstermez. Auth ve hesap yanıtları private/no-store kalır; statik OpenAPI belgesi özel veri içermez ve public cache kullanabilir.

## Doğrulama

`node scripts/generate-storefront-account-v2-openapi.mjs --check` Native route/method ve kaynak hash eşleşmesini denetler. `node --test scripts/test-storefront-account-v2-openapi.mjs` statik GET/HEAD'nin sıfır DB/oturum/provider erişimini, gerçek cookie/OAuth scope/origin/sahiplik sınırlarını ve canonical katalog eşleşmesini doğrular. Mevcut hesap, e-posta değişikliği, veri bütünlüğü ve çalışma alanı testleri ayrıca korunur. Yerel test başarısı canlı yayın veya mağaza aktivasyonu değildir.
