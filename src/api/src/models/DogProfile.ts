export class DogProfile {
    id: string;
    name: string;
    age: number;
    breed: string;
    adoptionUrl: string;
    gender: string;
    size: string;
    shots: number;
    housetrained: number;
    okWithKids: number;
    okWithDogs: number;
    okWithCats: number;
    specialNeeds: number;

    constructor(
        id: string,
        name: string,
        age: number,
        breed: string,
        adoptionUrl: string,
        gender: string,
        size: string,
        shots: number,
        housetrained: number,
        okWithKids: number,
        okWithDogs: number,
        okWithCats: number,
        specialNeeds: number
    ) {
        this.id = id;
        this.name = name;
        this.age = age;
        this.breed = breed;
        this.adoptionUrl = adoptionUrl;
        this.gender = gender;
        this.size = size;
        this.shots = shots;
        this.housetrained = housetrained;
        this.okWithKids = okWithKids;
        this.okWithDogs = okWithDogs;
        this.okWithCats = okWithCats;
        this.specialNeeds = specialNeeds;
    }

    toHtml(): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Card Generator</title>
            <link rel="stylesheet" href="./card.css">
        </head>
        <body>
            <div id="card-front" class="business-card business-card-front">
                <img src="./logo.png" alt="Paws Rescue League Logo" class="logo no-space">
                <span class="no-space">www.pawsrescueleague.com</span>
                <img src="./portrait3-cropped.jpeg" alt="Portrait" class="portrait no-space">
                <span class="no-space">${this.name}<br>${this.age}yr ${this.breed}</span>
            </div>
            <div id="card-back" class="business-card business-card-back">
                <span class="no-space centered">${this.adoptionUrl}</span>
                <div class="qr-code no-space">
                    <img src="./qr.svg" alt="QR Code">
                </div>
                <div class="attributes">
                    <table>
                        <tr><td>Age:</td><td>${this.age}yr</td></tr>
                        <tr><td>Gender:</td><td>${this.gender}</td></tr>
                        <tr><td>Size:</td><td>${this.size}</td></tr>
                        <tr><td>Shots:</td><td>${this.shots ? '✅' : '❌'}</td></tr>
                        <tr><td>Housetrained:</td><td>${this.housetrained ? '✅' : '❌'}</td></tr>
                        <tr><td>OK with kids:</td><td>${this.okWithKids ? '✅' : '❌'}</td></tr>
                        <tr><td>OK with dogs:</td><td>${this.okWithDogs ? '✅' : '❌'}</td></tr>
                        <tr><td>OK with cats:</td><td>${this.okWithCats ? '✅' : '❌'}</td></tr>
                        <tr><td>Special Needs:</td><td>${this.specialNeeds ? '✅' : '❌'}</td></tr>
                    </table>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}
