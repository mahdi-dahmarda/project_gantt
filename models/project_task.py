from odoo import models, fields, api
from datetime import datetime

class ProjectTask(models.Model):
    _inherit = "project.task"

    date_start = fields.Date(string='Start Date', index=True, copy=False, tracking=True, task_dependency_tracking=True)
    program_director = fields.Many2many('res.users', string='Program Director', relation='project_task_program_director_rel')
    technical_manager = fields.Many2many('res.users', string='Technical Manager', relation='project_task_technical_manager_rel')
    project_manager = fields.Many2many('res.users', string='Project Manager', relation='project_task_project_manager_rel')

    @api.model
    def get_project_manager_remarks(self):
        remarks = []
        for message in self.message_ids:
            if message.body and message.author_id.id in self.project_manager.partner_id.ids:
                remarks.append(message.body)
        return remarks

    @api.model
    def get_technical_manager_remarks(self):
        remarks = []
        for message in self.message_ids:
            if message.body and message.author_id.id in self.technical_manager.partner_id.ids:
                remarks.append(message.body)
        return remarks

    @api.model
    def get_program_director_remarks(self):
        remarks = []
        for message in self.message_ids:
            if message.body and message.author_id.id in self.program_director.partner_id.ids:
                remarks.append(message.body)
        return remarks

    @api.model
    def get_customer_remarks(self):
        remarks = []
        for message in self.message_ids:
            if message.body and message.author_id.id in self.partner_id.ids:
                remarks.append(message.body)
                print(message.body)
        # print(remarks)
        return remarks
