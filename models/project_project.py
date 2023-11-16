from odoo import models, fields, api

class ProjectProject(models.Model):
    _inherit = "project.project"

    # Add computed fields for start and end dates
    exact_start_date = fields.Date(string='EStart Date', compute='_compute_exact_start_date', default=fields.Date.today())
    exact_end_date = fields.Date(string='EEnd Date', compute='_compute_exact_end_date', default=fields.Date.today())
    project_progress = fields.Float(string='project progress', compute='_compute_project_progress')

    @api.depends('tasks.date_start')
    def _compute_exact_start_date(self):
        for project in self:
            start_dates = []
            for task in project.tasks:
                if task.date_start:
                    start_dates.append(task.date_start)
            if start_dates:
                project.exact_start_date = min(start_dates)
            else:
                project.exact_start_date = None

    @api.depends('tasks.date_deadline')
    def _compute_exact_end_date(self):
        for project in self:
            end_dates = []
            for task in project.tasks:
                if task.date_deadline:
                    end_dates.append(task.date_deadline)
            if end_dates:
                project.exact_end_date = max(end_dates)
            else:
                project.exact_end_date = None

    @api.depends('tasks.progress')
    def _compute_project_progress(self):
        for project in self:
            planned_hours = 0
            remaining_hours = 0
            subtask_planned_hours = 0
            subtask_effective_hours = 0
            for task in project.tasks:
                planned_hours += task.planned_hours
                remaining_hours += task.remaining_hours
                subtask_planned_hours += task.subtask_planned_hours
                subtask_effective_hours += task.subtask_effective_hours
            if task.subtask_planned_hours or planned_hours:
                project.project_progress = ((planned_hours - remaining_hours) + subtask_effective_hours) / (planned_hours + subtask_planned_hours) * 100
            else:
                project.project_progress = 0.0

