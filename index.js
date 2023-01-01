const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { query } = require('express');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.llx3uvn.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function veryfyJWT(req, res, next){
    console.log('token inside verifyJWT', req.headers.authorization);
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unautorized access');
    }

    const token = authHeader.split( ' ' )[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        console.log(err);
        if(err){
            return res.status(403).send({message:'forbidden access'})
        }
        req.decoded = decoded;
        next();
    })

}
async function run (){
try{
    const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingsCollection = client.db('doctorsPortal').collection('bookings');
    const usersCollection = client.db('doctorsPortal').collection('users');
    const doctorsCollection = client.db('doctorsPortal').collection('doctors');

    // NOTE: make sure you use veryfyAdmin after veryfyJWT
    const veryfyAdmin = async (req, res, next) =>{
        const decodedEmail = req.decoded.email;
        const query = {email: decodedEmail};
        const user = await usersCollection.findOne(query);

            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'forbidden access'})
            }
        next();
        
    }
    // Use Aggregate to query multiple collection and then merge data
    app.get('/appointmentOptions', async(req, res) => {
        const date = req.query.date;
        const query = {};
        const options = await appointmentOptionCollection.find(query).toArray();

        // get the bookings of the provied date
        const bookingQuery = {appoinmentDate: date}
        const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
        // code carefully :
        options.forEach(option => {
          const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
          const bookedSlots = optionBooked.map(book => book.slot);
          const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot));
            option.slots = remainingSlots;
  
        })

        res.send(options);
    });

    app.get('/v2/appointmentionOptions', async(req, res) =>{
        const date = req.query.date;
        const options = await appointmentOptionCollection.aggregate([
            {
                $lookup:
                {
                   from: 'bookings',
                   localField: 'name',
                   foreignField: 'treatment',
                    pipeline: [
                        {
                            $match: {
                               $expr:{
                                $eq: ['$appoinmentDate', date]
                               } 
                            }
                        }
                     ],
                   as: 'booked'
                } 
            },
            {
              $project: {
                name: 1,
                price: 1, 
                slots: 1,
                booked: {
                    $map: {
                       input: '$booked',
                       as: 'book', 
                       in: '$$book.slot'
                    }
                }
              }  
            },
            {
                $project: {
                    name: 1,
                    price: 1, 
                    slots: {
                        $setDifference: ['$slots', '$booked']
                    }
                }
            }
        ]).toArray();
        res.send(options);
   
    })

    app.get('/appointmentSpecialty', async(req, res) =>{
        const query = {}
        const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
        res.send(result);
    })
    /**
     * API Naming Convention 
     * app.get('/bookings)
     * app.get('/bookings/:id)
     * app.post('/bookings)
     * app.patch('/bookings/:id)
     * app.delete('/bookings/:id)
     */

    app.get('/bookings', veryfyJWT, async(req, res) =>{
        const email = req.query.email;

        const decodedEmail = req.decoded.email;
        console.log(email, decodedEmail);

        if(email !== decodedEmail){
            return res.status(403).send({message: 'forbidden access'});
        }
        const query = { email: email };
        const bookings = await bookingsCollection.find(query).toArray();
        res.send(bookings);
    });

    app.get('/bookings/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: ObjectId(id) };
        const booking = await bookingsCollection.findOne(query);
        res.send(booking);
    })

    app.post('/bookings', async(req, res) =>{
        const booking = req.body;
        console.log(booking);
        const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
        }

        const alreadyBooked = await bookingsCollection.find(query).toArray();

        if (alreadyBooked.length){
            const message = `You already have a booking on ${booking.appoinmentDate}`
            return res.send({acknowledged: false, message})
        }
        const result = await bookingsCollection.insertOne(booking);
        res.send(result);
    });

    app.post('/create-payment-intent', async (req, res) =>{
        const bookings = req.body;
        const price = bookings.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": [
                "card"
            ]
        });
        res.send({
            clientSecret: paymentIntent.client_secret,

        });
    })

    // app.get('/jwt', async(req, res) =>{
    //     const email = req.query.email;
    //     const query = {email: email};
    //     const user = await usersCollection.findOne(query);
    //     console.log(process.env.ACCESS_TOKEN, email, user)
    //     if(user){
    //        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '7d'})
    //        console.log(token);
    //        return res.send({accessToken: token});
    //     }
    //    res.send(403).send({accessToken: ''})
    // });

    // app.get('/users', async(req, res) =>{
    //     const users = await usersCollection.find({}).toArray();
    //     res.send(users);
    // });

    // app.get('/users/admin/:email', async (req, res) => {
    //     const email = req.params.email;
    //     const query = { email }
    //     const user = await usersCollection.findOne(query);
    //     res.send({ isAdmin: user?.role === 'admin' });
       
    // })

    // app.post('/users', async(req, res) =>{
    //     const user = req.body;
    //     console.log(user);
    //     const result = await usersCollection.insertOne(user);
    //     res.send(result);
    // });

    // app.put('/users/admin/:id', veryfyJWT, veryfyAdmin, async(req, res) =>{
    //     const id = req.params.id;
    //     const filter = { _id: ObjectId(id) }
    //     const options = { upsert: true};
    //     const updatedDoc = {
    //         $set : {
    //            role: 'admin' 
    //         }
    //     }
    //     const result = await usersCollection.updatedOne(filter, updatedDoc, options)
    //     res.send(result);
    // });

    // temporary to update price field on appointment options
    // app.get('/addPrice', async(req, res) =>{
    //     const filter = {}
    //     const options = { upsert: true }
    //     const updatedDoc = {
    //         $set : {
    //            price: 99 
    //         }
    //     }
    //     const result = await appointmentOptionCollection.updatedMany(filter, updatedDoc, options)
    //     res.send(result);
    // })

//     app.get('/doctors', async(req, res) =>{
//         const query = {};
//         const doctors = await doctorsCollection.find(query).toArray();
//         res.send(doctors);
//     })

//     app.post('/doctors', veryfyJWT, veryfyAdmin, async(req, res) =>{
//         const doctor = req.body;
//         const result = await doctorsCollection.insertOne(doctor);
//         res.send(result);
//     });

//     app.delete('/doctors/:id', veryfyJWT, veryfyAdmin, async(req, res) => {
//         const id = req.params.id;
//         const filter = {_id: ObjectId(id) };
//         const result = await doctorsCollection.deleteOne(filter);
//         res.send(result);
//     })
// }
// finally{

// }
// }
// run().catch(console.log);

// app.get('/', async(req, res) =>{
// res.send('doctors portal server is running');
// })

// app.listen(port, () => console.log(`Doctors portal running on ${port}`))