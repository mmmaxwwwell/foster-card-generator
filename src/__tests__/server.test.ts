import { app } from '../server';
import { createServer, request, Server } from 'http';

describe('GET /', () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(app);
    server.listen(done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('should return Hello World!', (done) => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address is invalid');
    }
    const options = {
      hostname: 'localhost',
      port: address.port,
      path: '/',
      method: 'GET'
    };

    const req = request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        expect(res.statusCode).toBe(200);
        expect(data).toBe('Hello World!');
        done();
      });
    });

    req.on('error', (e) => {
      done(e);
    });

    req.end();
  });

  it('should create a dog profile and retrieve it', (done) => {
    const postData = JSON.stringify({
      name: 'Fido',
      age: 3,
      breed: 'Labrador',
      adoptionUrl: 'http://example.com',
      gender: 'male',
      size: 'medium',
      shots: true,
      housetrained: true,
      okWithKids: true,
      okWithDogs: true,
      okWithCats: false,
      specialNeeds: false
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address is invalid');
    }

    const postOptions = {
      hostname: 'localhost',
      port: address.port,
      path: '/card',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData).toString()
      }
    };

    const postReq = request(postOptions, (postRes) => {
      let resBody = '';
      postRes.on('data', (chunk) => {
        resBody += chunk;
      });
      postRes.on('end', () => {
        // Expect a location header for the redirect URL
        const location = postRes.headers.location;
        expect(location).toBeDefined();

        const getOptions = {
          hostname: 'localhost',
          port: address.port,
          path: location,
          method: 'GET'
        };

        const getReq = request(getOptions, (getRes) => {
          let getData = '';
          getRes.on('data', (chunk) => {
            getData += chunk;
          });
          getRes.on('end', () => {
            expect(getRes.statusCode).toBe(200);
            expect(getData).toContain('Fido'); // Verify that the dog's name is present
            done();
          });
        });
        getReq.on('error', (err) => done(err));
        getReq.end();
      });
    });

    postReq.on('error', (err) => done(err));
    postReq.write(postData);
    postReq.end();
  });
});
