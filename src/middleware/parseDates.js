
const parseDates = async (req, res, next) => {
    const {start, end} = req.query;
    let startDate, endDate
    if (start) {
        startDate = new Date(start)
        console.log(startDate)
    } else {
        startDate = new Date()
        startDate.setDate(startDate.getDate() - 1)
    }
    endDate = end ? new Date(end) : new Date()
    if (startDate > endDate) return res.status(400).json({message: "End date can not be older than start date"})
    req.startDate = startDate
    req.endDate = endDate
    next()
}
module.exports = {parseDates}