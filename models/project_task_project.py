from odoo import fields, models


class ProjectProject(models.Model):
    _inherit = "project.project"

    date_start = fields.Datetime("Start Date")
    date = fields.Datetime("End Date")

class ProjectTask(models.Model):
    _inherit = "project.task"

    date_assign = fields.Datetime("Date Assign")
    date_deadline = fields.Datetime("Date Deadline")
