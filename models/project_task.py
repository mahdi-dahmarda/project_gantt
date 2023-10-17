from odoo import models, fields

class ProjectTask(models.Model):
    _inherit = "project.task"

    date_start = fields.Date(string='Start Date', index=True, copy=False, tracking=True, task_dependency_tracking=True)