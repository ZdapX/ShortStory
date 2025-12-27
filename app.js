
const express = require('express');
const { Redis } = require('@upstash/redis');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Konfigurasi Database Upstash
const redis = new Redis({
  url: 'https://enough-kodiak-11567.upstash.io',
  token: 'AS0vAAIncDEzZTZhMzRiZjAzNWU0NzMwOTNhZGJjYTkxMzIxYjVhM3AxMTE1Njc',
});

// Setting View Engine untuk Vercel
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json());

// ROUTE: Beranda
app.get('/', async (req, res) => {
    try {
        const search = req.query.search || '';
        // Ambil data dari Redis
        const allStories = await redis.hgetall('stories');
        
        let stories = [];
        
        // Cek jika allStories tidak null dan ada isinya
        if (allStories) {
            stories = Object.values(allStories).map(s => {
                return typeof s === 'string' ? JSON.parse(s) : s;
            });
        }

        // Fitur Search
        if (search) {
            stories = stories.filter(s => 
                (s.title && s.title.toLowerCase().includes(search.toLowerCase())) || 
                (s.genre && s.genre.toLowerCase().includes(search.toLowerCase()))
            );
        }

        // Urutkan dari yang terbaru
        stories.reverse();

        res.render('index', { stories, search });
    } catch (err) {
        console.error("Error Database:", err);
        // Kirim array kosong jika error agar web tidak crash
        res.render('index', { stories: [], search: '' });
    }
});

// ROUTE: Halaman Upload
app.get('/upload', (req, res) => {
    res.render('upload');
});

// ROUTE: Proses Simpan
app.post('/upload', async (req, res) => {
    try {
        const { title, genre, storyText, authorName, authorImg, coverImg, authorImgFile, coverImgFile } = req.body;
        const id = uuidv4();
        
        const finalAuthorImg = authorImgFile || authorImg || `https://ui-avatars.com/api/?name=${authorName}`;
        const finalCoverImg = coverImgFile || coverImg || 'https://via.placeholder.com/400x250?text=No+Cover';

        const newStory = {
            id,
            title,
            genre,
            storyText,
            authorName,
            authorImg: finalAuthorImg,
            coverImg: finalCoverImg,
            createdAt: new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })
        };

        await redis.hset('stories', { [id]: JSON.stringify(newStory) });
        res.redirect('/');
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).send("Gagal mengupload cerita");
    }
});

// ROUTE: Detail Story
app.get('/story/:id', async (req, res) => {
    try {
        const storyData = await redis.hget('stories', req.params.id);
        if (!storyData) return res.status(404).send("Cerita tidak ditemukan");
        
        const story = typeof storyData === 'string' ? JSON.parse(storyData) : storyData;
        res.render('story', { story });
    } catch (err) {
        res.status(500).send("Terjadi kesalahan saat memuat cerita");
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server running on http://localhost:3000'));
}
