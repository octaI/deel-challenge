const {Op} = require("sequelize");
const {sequelize} = require('../model')
const getJobDebt = async (req, res, next) => {
    const {Profile, Contract, Job} = req.app.get('models')
    const {profile} = req
    const {userId} = req.params
    const client = await Profile.findOne(
        {
            where: {id: userId, type: "client"}
        }
    )
    if (!client) return res.status(404).end()
    const jobDebt = await Profile.findOne(
        {
            subQuery: false,
            where: {id: userId},
            attributes:["id", [sequelize.literal('SUM(`Client->Jobs`.price)'), 'total_debt']],
            include: [
                {
                    model: Contract,
                    where: {ClientId: userId},
                    attributes: [],
                    as: 'Client',
                    include: {model: Job, attributes: [], where: {
                            [Op.or] : [
                                {paid: null},
                                {paid: false}
                            ]}}
                }
            ],
            raw: true,
        }
    )
    req.jobDebt = jobDebt.total_debt
    req.client = client
    next()
}
module.exports = {getJobDebt}