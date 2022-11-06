const {Op} = require("sequelize");
const {sequelize} = require('../model')
const getContractor = async (req, res, next) => {
    const {Profile, Contract, Job} = req.app.get('models')
    const {profile} = req
    if (profile.type !== "client") return res.status(403).end()
    const {job_id} = req.params
    const contractor = await Profile.findOne(
        {
            subQuery: false,
            where: {id: sequelize.col('Contractor.ContractorId')},
            include: [
                {
                    model: Contract,
                    where: {ClientId: profile.id},
                    attributes: [],
                    as: 'Contractor',
                    include: {model: Job, attributes: [], where: {id: job_id,
                            [Op.or] : [
                                {paid: null},
                                {paid: false}
                            ]}}
                }
            ]
        }
    )
    if (!contractor) return res.status(404).end()
    req.contractor = contractor
    next()
}
module.exports = {getContractor}