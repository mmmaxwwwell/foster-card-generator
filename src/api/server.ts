import express, { Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import { DogProfile } from './models/DogProfile'; // Add this import

const app = express();
const port = 3000;

const db = new sqlite3.Database(':memory:');

app.use(express.json());

db.serialize(() => {
    db.run(`CREATE TABLE DogProfile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        age INTEGER,
        breed TEXT,
        adoptionUrl TEXT,
        gender TEXT,
        size TEXT,
        shots BOOLEAN,
        housetrained BOOLEAN,
        okWithKids BOOLEAN,
        okWithDogs BOOLEAN,
        okWithCats BOOLEAN,
        specialNeeds BOOLEAN
    )`);
});

app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
});

interface DogProfileRequest {
    id: string,
    name: string;
    age: number;
    breed: string;
    adoptionUrl: string;
    gender: string;
    size: string;
    shots: boolean;
    housetrained: boolean;
    okWithKids: boolean;
    okWithDogs: boolean;
    okWithCats: boolean;
    specialNeeds: boolean;
}

app.post('/card', (req: Request<{}, {}, DogProfileRequest & { id?: number }>, res: Response) => {
    const { id, name, age, breed, adoptionUrl, gender, size, shots, housetrained, okWithKids, okWithDogs, okWithCats, specialNeeds } = req.body;

    if (id) {
        db.run(`UPDATE DogProfile SET name = ?, age = ?, breed = ?, adoptionUrl = ?, gender = ?, size = ?, shots = ?, housetrained = ?, okWithKids = ?, okWithDogs = ?, okWithCats = ?, specialNeeds = ? WHERE id = ?`, 
        [name, age, breed, adoptionUrl, gender, size, shots, housetrained, okWithKids, okWithDogs, okWithCats, specialNeeds, id], function(err) {
            if (err) {
                return res.status(500).send('Failed to update dog profile');
            }
            res.status(200).send('Dog profile updated successfully');
        });
    } else {
        db.run(`INSERT INTO DogProfile (name, age, breed, adoptionUrl, gender, size, shots, housetrained, okWithKids, okWithDogs, okWithCats, specialNeeds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [name, age, breed, adoptionUrl, gender, size, shots, housetrained, okWithKids, okWithDogs, okWithCats, specialNeeds], function(err) {
            if (err) {
                return res.status(500).send('Failed to create dog profile');
            }
            res.status(200).redirect(`/card/${this.lastID}`);
        });
    }
});

app.get('/card/:id', (req: Request, res: Response) => {
    const cardId = req.params.id;
    db.get(`SELECT * FROM DogProfile WHERE id = ?`, [cardId], (err, row)   => {
        if (err) {
            return res.status(500).send('Failed to retrieve dog profile');
        }
        if (!row) {
            return res.status(404).send('Dog profile not found');
        }
        const row2 = row as DogProfileRequest;
        const dogProfile = new DogProfile(
            row2.id, row2.name, row2.age, row2.breed, row2.adoptionUrl, row2.gender, row2.size,
            row2.shots, row2.housetrained, row2.okWithKids, row2.okWithDogs, row2.okWithCats, row2.specialNeeds
        );
        res.status(200).send(dogProfile.toHtml());
    });
});

// Add endpoint to list all cards with id and name
app.get('/cards', (req: Request, res: Response) => {
    db.all('SELECT id, name FROM DogProfile', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve dog profiles' });
        }
        res.status(200).json(rows);
    });
});

// app.post('/upload-image', upload.single('image'), (req: Request, res: Response) => {
//     const file = req.file;
//     if (!file) {
//         return res.status(400).send('No file uploaded.');
//     }
//     // Logic to handle the uploaded file
//     res.status(201).send('File uploaded successfully');
// });

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});

export { app }; // Add this export
