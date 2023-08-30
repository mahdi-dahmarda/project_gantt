from odoo import fields, models


class View(models.Model):
    _inherit = "ir.ui.view"
    _description = "Gantt Chart"

    type = fields.Selection(
        selection_add=[("gantt", "Gantt")]
    )
