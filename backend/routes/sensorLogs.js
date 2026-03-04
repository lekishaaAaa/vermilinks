const express = require('express');
const { Op } = require('sequelize');
const sensorLogController = require('../controllers/sensorLogController');
const SensorLog = require('../models/SensorLog');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, adminOnly, sensorLogController.list);
router.delete('/bulk', auth, adminOnly, async (req, res) => {
	const rawIds = Array.isArray(req.body?.ids)
		? req.body.ids
		: Array.isArray(req.body)
			? req.body
			: typeof req.query?.ids === 'string'
				? req.query.ids.split(',')
				: [];

	const ids = rawIds
		.map((id) => Number.parseInt(id, 10))
		.filter((id) => Number.isFinite(id) && id > 0);

	if (!Array.isArray(rawIds) || ids.length === 0) {
		return res.status(400).json({ error: 'Provide valid sensor log IDs' });
	}

	const batchSize = 500;
	let deleted = 0;

	try {
		for (let index = 0; index < ids.length; index += batchSize) {
			const batch = ids.slice(index, index + batchSize);
			const count = await SensorLog.destroy({ where: { id: { [Op.in]: batch } } });
			deleted += Number(count || 0);
		}

		return res.json({ success: true, deleted, requested: ids.length, batchSize });
	} catch (error) {
		return res.status(500).json({ error: 'Unable to bulk delete sensor logs' });
	}
});

router.delete('/all', auth, adminOnly, async (_req, res) => {
	try {
		await SensorLog.destroy({ where: {}, truncate: true });
		return res.json({ status: 'all logs removed' });
	} catch (error) {
		return res.status(500).json({ error: 'Unable to delete all sensor logs' });
	}
});
router.delete('/:id', auth, adminOnly, sensorLogController.remove);
router.delete('/', auth, adminOnly, sensorLogController.purge);

module.exports = router;
