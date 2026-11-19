require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");
const {connectMongo, getMongo} = require("./mongo");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// root route // 
app.get("/", (req, res) => {
    res.json({message: "era tech solutions helpdesk api is running"});
});

// GET /departments - returns all departments //
app.get("/departments", (req, res) => {
    const sql = 'SELECT * FROM departments';
    db.query(sql,(error, results) => {
        if (error) {
            console.error("error getting departmetns:", error);
            return res.status(500).json({error: "failed to get departments"});
        }
        res.json(results);
    });
});

// GET /users
app.get("/users", (req, res) => {
    const sql = 'SELECT id, first_name, last_name, email, role, department_id FROM users';
    db.query(sql, (error, results) => {
        if (error) {
            console.error("error getting users:", error);
            return res.status(500).json({error: "failed to get users"});
        }
        res.json(results);
    });
});

// GET /tickets
app.get("/tickets", (req, res) => {
    const sql = 'SELECT * FROM tickets';
    db.query(sql, (error, results) => {
        if (error) {
            console.error("error getting tickets:", error);
            return res.status(500).json({error: "failed to get tickets"});
        }
        res.json(results);
    });
});

// GET /tickets/open - returns only open tickets
app.get("/tickets/open", (req, res) => {
    const sql = 'SELECT * FROM tickets WHERE status = "open"';
    db.query(sql, (error, results) => {
        if (error) {
            console.error("error getting open tickets:", error);
            return res.status(500).json({error: "failed to get open tickets"});
        }
        res.json(results);
    });
});

// GET /tickets/:id - returns a single ticket by id
app.get("/tickets/:id", (req, res) => {
    const ticketId = req.params.id;
    const sql = 'SELECT * FROM tickets WHERE id = ?';
    db.query(sql, [ticketId], (error, results) => {
        if (error) {
            console.error("error getting ticket:", error);
            return res.status(500).json({error: "failed to get ticket"});
        }
        if (results.length === 0) {
            return res.status(404).json({error: "ticket not found"});
        }
            res.json(results[0]);
    });
});

// POST /users -- creates a new user
app.post("/users", (req, res) => {
    const {first_name, last_name, email, password, role, department_id} = req.body;

// Check required fields
    if (!first_name || !last_name || !email || !password) {
        return res.status(400).json({
            error: "first_name, last_name, email, password, role, department_id are required"
    });
}

// Password rule 1:minimum 8 characters
if (password.length < 8) {
    return res.status(400).json({error: "password must be at least 8 characters long"});
}

// Password rule 2: at least 1 special character
    const specialCharRegex = /[!@#$%]/;
        if (!specialCharRegex.test(password)) {
            return res.status(400).json({
                error: "password must contain at least 1 special character: !@#$%"
            });
        }
    const sql = 'INSERT INTO users (first_name, last_name, email, password, role, department_id) VALUES (?, ?, ?, ?, ?, ?)';
    const userRole = role || "employee";
    const deptId = department_id || null;

    db.query(sql, [first_name, last_name, email, password, userRole, deptId], (error, results) => {
        if (error) {
            // same email used twice - the unique rule on the email column blocked it
            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({error: "email already exists"});
            }
            console.error("error creating user:", error);
            return res.status(500).json({error: "failed to create user"});
        }
        res.status(201).json({message: "user created successfully",
        userId: results.insertId
        });
    });
});

// POST /tickets -- creates a new ticket and automatically logs to mongoDB
    app.post("/tickets", async(req, res) => {
        const {title, description, status, priority, submitted_by, assigned_to, department_id} = req.body;
    // validate required fields
    if (!title || !submitted_by) {
        return res.status(400).json({error: "title and submitted by are required"});
    }
    const ticketPriority = priority || "medium";
    const ticketStatus = status || "open";
    const assignedTo = assigned_to || null;
    const deptId = department_id || null;

    const sql = 'INSERT INTO tickets (title, description, status, priority, submitted_by, assigned_to, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [title, description, ticketStatus, ticketPriority, submitted_by, assignedTo, deptId], async(error, results) => {
        if (error) {
            console.error("error creating ticket:", error);
            return res.status(500).json({error: "failed to create ticket"});
        }
        const newTicketId = results.insertId;
// log ticket creation to MongoDB
        try {  
            const mongoDb = getMongo();
            await mongoDb.collection("activity_logs").insertOne({
                action: "ticket_created",
                user_id: submitted_by,
                ticket_id: newTicketId,
                details: `ticket created: ${title}`,
                timestamp: new Date()
            });
        } catch (mongoError) {
            console.error("failed to log activity:", mongoError);
// do not fail the request if logging fails, just log the error
        }
        res.status(201).json({
            message: "ticket created successfully",
            ticketId: newTicketId
        });
    });
});

// GET /ticket-notes --returns all ticket notes from Mongo DB
app.get("/ticket-notes", async(req, res) => {
    try{
        const mongoDb = getMongo();
        const notes = await mongoDb.collection("ticket_notes").find({}).toArray();
        res.json(notes);
    } catch (error) {
        console.error("error getting ticket notes:", error);
        res.status(500).json({error: "failed to get ticket notes"});
    }
});

// GET /ticket-notes/:ticketId --returns all ticket notes for a specific ticket from Mongo DB
app.get("/ticket-notes/:ticketId", async(req, res) => {
    try {
        const ticketID = parseInt(req.params.ticketId);
        const mongoDb = getMongo();
        const notes = await mongoDb.collection("ticket_notes").find({ticket_id: ticketID}).toArray();
        res.json(notes);
    } catch (error) {
        console.error("error getting notes for ticket:", error);
        res.status(500).json({error: "failed to get ticket notes"});
    }
});

// GET /activity-logs --returns all activity logs from Mongo DB
app.get("/activity-logs", async(req, res) => {
    try {
        const mongoDb = getMongo();
        const logs = await mongoDb.collection("activity_logs").find({}).sort({timestamp: -1}).toArray();
        res.json(logs);
    } catch (error) {
        console.error("error getting activity logs:", error);
        res.status(500).json({error: "failed to get activity logs"});
    }   
});

// POST /ticket-notes -- creates a new ticket note and automatically logs to mongoDB
app.post("/ticket-notes", async(req, res) => {
    const {ticket_id, note, added_by} = req.body;
    if (!ticket_id || !note || !added_by) {
        return res.status(400).json({error: "ticket_id, note, and added_by are required"});
    }
    try {
        const mongoDb = getMongo();
        const result = await mongoDb.collection("ticket_notes").insertOne({
            ticket_id: parseInt(ticket_id),
            note: note,
            added_by: added_by,
            created_at: new Date()
        });
        res.status(201).json({
            message: "ticket note created successfully",
            noteId: result.insertedId
        });
    } catch (error) {
        console.error("error adding note:", error);
        res.status(500).json({error: "failed to add ticket note"});
    }
});

// POST /activity-logs -- creates a new activity log in MongoDB
app.post("/activity-logs", async(req, res) => {
    const {action, user_id, ticket_id, details} = req.body;
    if (!action || !details) {
        return res.status(400).json({error: "action and details are required"});
    }
    try {
        const mongoDb = getMongo();
        const result = await mongoDb.collection("activity_logs").insertOne({
            action: action,
            user_id: user_id || null,
            ticket_id: ticket_id || null,
            details: details,
            timestamp: new Date()
        });
        res.status(201).json({
            message: "activity log created",
            logId: result.insertedId
        });
    } catch (error) {
        console.error("error creating activity log:", error);
        res.status(500).json({error: "failed to create activity log"});
    }
});

// start server - waits for mongo db before listening //
async function startServer(){
    await connectMongo();
    app.listen(PORT, () => {
        console.log(`server running at http://localhost:${PORT}`);
    });
}

startServer();