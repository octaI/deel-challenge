const express = require('express');
const bodyParser = require('body-parser');
const {LOCK} = require("sequelize");
const {getJobDebt} = require("./middleware/getJobDebt");
const {sequelize} = require('./model')
const {Op} = require('sequelize')
const {getContractor} = require("./middleware/getContractor");
const {getProfile} = require('./middleware/getProfile')
const {parseDates} = require('./middleware/parseDates')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id belonging to a user
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const {profile} = req
    const contract = await Contract.findOne(
        {
            where:
                {
                    id,
                    [Op.or]:
                        [
                            {ClientId: {[Op.eq]: profile.id}},
                            {ContractorId: {[Op.eq]: profile.id}}
                        ]
                }
        })
    if (!contract) return res.status(404).end()
    res.json(contract)
})
/**
 * @returns Array[<contract>] for a given user
 */
app.get('/contracts', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const {profile} = req
    const contracts = await Contract.findAll(
        {
            where:
                {
                    [Op.not]: {
                        status:  "terminated"
                    },
                    [Op.or]:
                        [
                            {ClientId: profile.id},
                            {ContractorId: profile.id}
                        ]
                }
        }
    )
    res.json(contracts || [])
})
/**
 * @returns Array[<Job>] with `paid=false || null` for a given user
 */
app.get("/jobs/unpaid", getProfile, async (req, res) => {
    const {Contract, Job} = req.app.get('models')
    const {profile} = req
    const jobs = await Job.findAll(
        {
            include: {
                model: Contract,
                attributes: [],
                where: {
                    status: "in_progress",
                    [Op.or] : [
                        {ClientId: profile.id},
                        {ContractorId: profile.id}
                    ]
                }
            },
            where: {
                [Op.or] : [
                    {paid: null},
                    {paid: false}
                ]
            }
        }
    )
    res.json(jobs)
})
/**
 * @returns highest paying profession as `total_earned` key in json response during a time period
 * given by start and end params.
 * If no start and end params supplied, yesterday and today are used respectively.
 */
app.get('/admin/best-profession', parseDates, async (req, res) => {
    const {Profile, Contract, Job} = req.app.get('models')
    const highestPaying = await Profile.findOne(
        {
            where: {
                type: "contractor"
            },
            attributes: ['profession', [sequelize.literal('COALESCE(SUM(`Contractor->Jobs`.price), 0)'), 'total_earned']],
            include: [
                {
                    model: Contract,
                    attributes: [],
                    as: "Contractor",
                    include: {model: Job, attributes: [], where: {paid: true, paymentDate: {[Op.gte] : req.startDate, [Op.lte]: req.endDate}}},
                },
                ],
            group: ['Profile.profession'],
            order: [[sequelize.literal('total_earned'), 'DESC']],
            subQuery: false,
        }
    )
    res.json(highestPaying)
})
/**
 * @returns clients that spent the most as `total_spent` key in each profile object for the json response.
 * given by start and end params. Hard result limit at 100, user can supply its own result limit. Default result
 * limit is 2
 * If no start and end params supplied, yesterday and today are used respectively.
 */
app.get('/admin/best-clients', parseDates, async (req, res) => {
    const {Profile, Contract, Job} = req.app.get('models')
    const {limit = 2} = req.query
    if (limit > 100) return res.status(401).json({message: "Can only request up to 100 clients"})
    const highestPaying = await Profile.findAll(
        {
            where: {
                type: "client"
            },
            attributes: ["id", "firstName", "lastName", [sequelize.literal('COALESCE(SUM(`Client->Jobs`.price), 0)'), 'total_spent']],
            include: [
                {
                    model: Contract,
                    attributes: [],
                    as: "Client",
                    include: {model: Job, attributes: [], where: {paid: true, paymentDate: {[Op.gte] : req.startDate, [Op.lte]: req.endDate}}},
                },
            ],
            group: ['Profile.id'],
            order: [[sequelize.literal('total_spent'), 'DESC']],
            subQuery: false,
            limit: limit,
        }
    )
    res.json(highestPaying)
})

/**
 * @returns allows client to perform a payment for a job. The job price is withdrawn optimistically from the client, and
 * returns error and rolls back if Insufficient balance or other issues are found
 */
app.post('/jobs/:job_id/pay', [getProfile, getContractor], async (req, res) => {
    const {Profile, Job} = req.app.get("models")
    const {job_id} = req.params
    const job = await Job.findOne({
        where: {
            id: job_id,
        }
    })

    try {
        const result = await sequelize.transaction(async (t) => {
            const profile = await Profile.findByPk(req.profile.id, {lock: true, transaction: t})
            const contractor = await Profile.findByPk(req.contractor.id, {lock: true, transaction: t})
            profile.balance = profile.balance - job.price
            if (profile.balance < 0 ){
                throw Error("Not enough balance to pay")
            }
            contractor.balance = contractor.balance + job.price
            job.paid = true
            await profile.save({transaction: t})
            await contractor.save({transaction: t})
            await job.save({transaction: t})
        })
    } catch (e) {
        console.log("Error while updating balance for user", req.profile.id)
        return res.status(400).end()
    }
    await req.profile.reload()
    res.status(200).json({message: `Job ${job_id} has been paid successfully. Remaining balance: ${req.profile.balance}`})
})

/**
 * @returns allows client to deposit balance. the amount is gathered from the request body
 * returns error and rolls back if amount exceeds 25% of the client's outstanding job debt
 */
app.post('/balances/deposit/:userId', [getJobDebt], async (req, res) => {
    const {amount} = req.body
    const {Profile} = req.app.get("models")
    const {userId} = req.params
    try {
        const result = await sequelize.transaction(async (t) => {
            if (amount > req.jobDebt*0.25) throw Error(`Can't deposit more than ${req.jobDebt * 0.25}`)
            const client = await Profile.findByPk(userId, {transaction: t, lock: true})
            client.balance = client.balance + amount
            await client.save({transaction: t})
        })

    } catch (e) {
        console.log("Error while processing deposit for client", userId)
        return res.status(400).json({message: "Error while processing deposit"}).end()
    }

    res.status(200).json({message: 'Deposit successfully processed'})
})
module.exports = app;
