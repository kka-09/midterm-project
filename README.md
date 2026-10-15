# Word Ladder Visualizer

Visualisasi interaktif untuk membandingkan **Breadth-First Search (BFS)**, **Greedy Best-First Search (GBFS)**, dan **A\*** dalam menyelesaikan permainan *Word Ladder* pada **kosakata bahasa Indonesia** (KBBI v6).

Proyek Tengah Semester (UTS) mata kuliah Konsep Kecerdasan Artifisial, Institut Teknologi Sepuluh Nopember (ITS).

> **Word Ladder**: ubah satu kata menjadi kata lain dengan mengganti **satu huruf per langkah**, dan setiap kata di antaranya harus ada di kamus. Contoh: `kata → kota → kola → bola`.

---

## Daftar Isi

- [Fitur](#fitur)
- [Formulasi Masalah](#formulasi-masalah)
- [Algoritma](#algoritma)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Cara Pakai](#cara-pakai)
- [CLI](#cli)
- [Pengujian](#pengujian)
- [Dataset](#dataset)
- [Struktur Proyek](#struktur-proyek)
- [Arsitektur](#arsitektur)
- [Batasan](#batasan)
- [Tim](#tim)

---

## Fitur

- Tiga algoritma pencarian yang bisa dipilih dan dibandingkan pada pasangan kata yang sama.
- Animasi graf pencarian (Cytoscape.js): node yang *discovered*, *visited*, dan jalur akhir.
- Kontrol pemutaran: **Play/Pause**, **Step**, **Back**, *scrubber* timeline, dan kecepatan 1–64 event per detik.
- Panel **Frontier** (isi *queue* / *priority list* saat ini), **Stats** (discovered, visited, kedalaman, panjang jalur), dan **Path** (jalur akhir).
- Validasi input dengan pesan yang jelas (huruf a–z saja, panjang kata sama, kata harus ada di kamus).
- Contoh pasangan kata siap pakai dan tombol tukar start/end.
- Input dan algoritma tercermin di URL hash (`#start=kata&end=bola&algo=astar`), sehingga konfigurasi mudah dibagikan. Membuka link tidak langsung menjalankan pencarian.
- Tema terang/gelap, tata letak responsif, dan dukungan *screen reader* (`aria-live`).
- Tanpa CDN saat runtime: Cytoscape.js v3.27.0 sudah ada di `vendor/`.

---

## Formulasi Masalah

| Komponen | Definisi |
|---|---|
| **State** | Satu kata valid dari KBBI dengan panjang tertentu |
| **Initial state** | Kata awal (`start`) |
| **Goal test** | State sama dengan kata tujuan (`end`) |
| **Transisi** | Ganti tepat satu huruf sehingga hasilnya kata valid di kamus |
| **Biaya langkah** | 1 (graf tak berbobot) |
| **Branching factor** | Jumlah tetangga suatu kata, bervariasi menurut panjang kata dan kepadatan kamus |

Tetangga suatu kata dicari lewat **indeks pola wildcard**. Kata `kata` menghasilkan pola `*ata`, `k*ta`, `ka*a`, `kat*`, dan semua kata yang cocok dengan salah satu pola itu menjadi tetangganya. Dengan begitu tidak perlu membandingkan kata dengan seluruh kamus.

---

## Algoritma

| Algoritma | Frontier | Kunci prioritas | Menjamin jalur terpendek? |
|---|---|---|---|
| **BFS** | FIFO queue | urutan masuk | Ya |
| **Greedy Best-First** | Priority queue | `h(n)` | Tidak |
| **A\*** | Priority queue | `f(n) = g(n) + h(n)`, seri dipecah dengan `h(n)` terkecil | Ya |

**Heuristik: Hamming distance.** `h(n)` adalah jumlah posisi huruf yang berbeda antara kata `n` dan kata tujuan. Setiap langkah hanya mengubah satu huruf, jadi paling banyak mengurangi `h` sebesar 1. Karena itu heuristik ini *admissible* (tidak pernah melebihi jarak sebenarnya) dan *consistent*, sehingga A\* menghasilkan jalur optimal.

Catatan implementasi:

- BFS dan GBFS menandai kata sebagai *discovered* saat pertama kali ditemukan dan tidak mengubah parent-nya.
- A\* mendukung event `reparent` ketika ditemukan rute yang lebih pendek ke node yang sudah *discovered*.
- Semua algoritma punya batas `SEARCH_MAX_VISITS = 50000`. Jika terlampaui, pencarian berhenti dengan alasan `limit`.
- Ketiganya mengembalikan struktur hasil yang sama: `{ algorithm, found, path, events, stats }`.

---

## Menjalankan Aplikasi

### Prasyarat

- **Node.js** 18 atau lebih baru (disarankan 20+), untuk menjalankan test dan CLI
- **Python 3**, untuk menyajikan file statis
- Peramban modern dengan dukungan ES Modules

### Langkah

```bash
git clone https://github.com/kka-09/midterm-project.git
cd midterm-project

# Opsional: hanya diperlukan jika ingin memperbarui dependensi dev
npm install

# Jalankan server statis
npm run serve
```

Buka **http://localhost:8080** di peramban.

> Aplikasi harus dibuka lewat HTTP (bukan `file://`) karena memakai ES Modules dan `fetch` untuk memuat dataset.

---

## Cara Pakai

1. Di tab **Setup**, isi kata **Start** dan **End** (panjang sama, 3–6 huruf), atau klik salah satu contoh.
2. Pilih **Algorithm**: BFS, Greedy best-first, atau A\*.
3. Klik **Start**. Pencarian dijalankan lebih dulu, lalu hasilnya diputar sebagai animasi.
4. Gunakan **Play/Pause**, **Step**, **Back**, *scrubber*, dan slider **Speed** untuk menelusuri proses langkah demi langkah.
5. Buka tab **Frontier**, **Stats**, dan **Path** untuk melihat kondisi pencarian secara detail.
6. Bandingkan algoritma dengan menjalankan pasangan kata yang sama menggunakan algoritma berbeda, lalu lihat selisih *visited* dan *discovered* di tab **Stats**.

Contoh pasangan kata bawaan: `kata → bola`, `makan → rumah`, `pulang → datang`, `cat → mau`.

---

## CLI

Untuk uji cepat tanpa antarmuka:

```bash
# Satu pencarian: node tools/ladder.mjs <start> <end> [bfs|greedy|astar]
node tools/ladder.mjs kata bola bfs

# Validasi semua contoh pasangan kata terhadap dataset asli
npm run smoke
```

CLI menampilkan jalur, statistik pencarian, hasil validasi event, dan waktu eksekusi.

---

## Pengujian

```bash
npm test
```

Memakai test runner bawaan Node.js (`node --test`). Cakupan test:

| File | Yang diuji |
|---|---|
| `bfs.test.js`, `greedy.test.js`, `astar.test.js` | Kebenaran jalur, urutan event, kasus tak terjangkau, batas visit, *reparent* |
| `data.test.js` | Pemuatan dataset, validasi input, pencarian tetangga |
| `events.test.js` | Validasi struktur dan urutan event |
| `replay.test.js` | Mesin pemutaran: play, step, back, scrub, kecepatan |
| `layout.test.js`, `renderer.test.js` | Tata letak graf dan batas jumlah node yang digambar |
| `ui.test.js` | Pesan validasi, ringkasan hasil, URL hash |

---

## Dataset

- **Sumber:** `dataset/kbbi_v6_raw.txt`, daftar kata KBBI v6.
- **Hasil olahan:** `dataset/patterns/N.json`, satu file per panjang kata. Setiap file memetakan pola wildcard ke daftar kata yang cocok:

```json
{
  "*ata": ["bata", "kata", "mata", "rata"],
  "k*ta": ["kata", "kita", "kota"]
}
```

- **Membangun ulang indeks:**

```bash
./dataset/build-pattern-index.sh dataset/kbbi_v6_raw.txt dataset/patterns
```

Skrip ini mengubah semua kata menjadi huruf kecil, hanya menyimpan kata yang terdiri dari huruf a–z (tanda hubung antar kata diperbolehkan), menghapus duplikat, lalu menulis file JSON per panjang kata. **File `*.json` lama di folder tujuan akan dihapus.**

Antarmuka saat ini mendukung kata sepanjang **3–6 huruf** (`SUPPORTED_LENGTHS` di `src/config.js`).

---

## Struktur Proyek

```
.
├── index.html              # Antarmuka aplikasi
├── styles.css
├── package.json
├── dataset/
│   ├── kbbi_v6_raw.txt     # Kamus mentah
│   ├── build-pattern-index.sh
│   └── patterns/           # Indeks pola per panjang kata (N.json)
├── src/
│   ├── main.js             # UI shell: menghubungkan semua modul
│   ├── config.js           # Konstanta (panjang kata, batas visit, kecepatan, contoh)
│   ├── data.js             # Pemuatan dataset, kamus, validasi input
│   ├── events.js           # Skema dan validator event pencarian
│   ├── replay.js           # Mesin pemutaran event
│   ├── renderer.js         # Penggambar graf (Cytoscape)
│   ├── layout.js           # Tata letak node
│   ├── search/
│   │   ├── bfs.js
│   │   ├── greedy.js
│   │   ├── astar.js
│   │   ├── heuristics.js   # Hamming distance
│   │   ├── heap.js         # Min-heap
│   │   ├── errors.js
│   │   └── index.js        # Registri algoritma dan runSearch()
│   └── ui/
│       ├── format.js       # Pesan dan label UI
│       └── hash.js         # Sinkronisasi URL hash
├── tools/
│   └── ladder.mjs          # CLI uji cepat
├── tests/                  # Unit test
└── vendor/
    └── cytoscape.min.js    # Cytoscape.js v3.27.0 (lokal)
```

---

## Arsitektur

Algoritma pencarian **dipisahkan sepenuhnya** dari tampilan. Pencarian dijalankan sekali sampai selesai dan menghasilkan daftar event. Event itulah yang diputar ulang oleh antarmuka.

```
Input ─▶ data.js ─▶ search/*.js ─▶ events[] ─▶ replay.js ─▶ renderer.js ─▶ Graf
         (kamus)    (BFS/GBFS/A*)   (log)      (play/step)  (Cytoscape)
```

Jenis event:

| Event | Arti |
|---|---|
| `discover` | Kata baru ditemukan dan masuk frontier (membawa `from`, `depth`, `score`) |
| `visit` | Kata diambil dari frontier dan diperluas |
| `reparent` | (A\*) Ditemukan rute lebih pendek ke kata yang sudah discovered |
| `path` | Jalur akhir ditemukan |
| `fail` | Pencarian gagal, dengan alasan `unreachable` atau `limit` |

Karena pencarian berbentuk log, animasi bisa dimundurkan (**Back**), di-*scrub*, dan dipercepat tanpa menjalankan ulang algoritma. Untuk menjaga performa, graf hanya menggambar maksimal **300 node** (batas keras 600). Sisanya dihitung sebagai *hidden* dan angkanya ditampilkan di layar.

---

## Batasan

- Hanya mendukung transisi **substitusi satu huruf**. Penyisipan dan penghapusan huruf (jarak Levenshtein) belum didukung.
- Kamus mengikuti KBBI v6, jadi kata gaul, serapan baru, atau kata di luar KBBI tidak dikenali.
- Panjang kata di UI dibatasi 3–6 huruf.
- Pencarian dibatasi 50.000 visit per eksekusi.
- GBFS tidak menjamin jalur terpendek. Ini sifat algoritmanya, bukan *bug*.

---

## Tim

<!-- Isi dengan nama dan NRP anggota kelompok -->

| Nama | NRP | Kontribusi |
|---|---|---|
| _nama_ | _NRP_ | _peran_ |

---

## Lisensi & Atribusi

- Visualisasi graf menggunakan [Cytoscape.js](https://js.cytoscape.org/) v3.27.0 (lisensi MIT).
- Daftar kata bersumber dari KBBI v6. Pastikan penggunaannya sesuai ketentuan sumber data.
