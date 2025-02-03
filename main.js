const express = require('express');
const multer = require('multer');
const app = express();
const port = 3000;

const upload = multer({ dest: 'uploads/' });

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.post('/card', (req, res) => {
    const cardData = req.body;
    // Logic to create a new card with cardData
    res.status(201).send('Card created successfully');
});

app.get('/card/:id', (req, res) => {
    const cardId = req.params.id;
    // Logic to retrieve and return the card data by cardId
    res.status(200).send(`Card data for card ID: ${cardId}`);
});

app.post('/upload-image', upload.single('image'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send('No file uploaded.');
    }
    // Logic to handle the uploaded file
    res.status(201).send('File uploaded successfully');
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
