from odoo import models, fields, api
from odoo.http import request
# from collections import Counter

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

    @api.onchange('task.progress')
    def _compute_project_progress(self):
        for project in self:
            planned_hours = 0
            remaining_hours = 0
            subtask_planned_hours = 0
            subtask_effective_hours = 0
            for task in project.tasks:
                if not task.parent_id:
                    if not task.child_ids:
                        planned_hours += task.planned_hours
                        remaining_hours += task.remaining_hours
                    if task.child_ids:
                        subtask_planned_hours += task.subtask_planned_hours
                        subtask_effective_hours += task.subtask_effective_hours
            if task.subtask_planned_hours or planned_hours:
                project.project_progress = ((planned_hours - remaining_hours) + subtask_effective_hours) / (
                            planned_hours + subtask_planned_hours) * 100
            else:
                project.project_progress = 0.0

    @api.model
    def get_all_task_report(self):
        company_working_hours = self.env.user.company_id.resource_calendar_id.hours_per_day
        is_uom_day = request.env['account.analytic.line']._is_timesheet_encode_uom_day()
        task_data = []
        for task in self.tasks:
            duration = 0
            if is_uom_day:
                duration = round(task.planned_hours / company_working_hours, 2)
            else:
                duration = task.planned_hours
            task_data.append({
                "name": task.name,
                "assignees": ', '.join(task.user_ids.mapped('name')),
                "stage": task.stage_id.name,
                "duration": duration,
            })
        return task_data

    def get_task_count(self):
        return len(self.tasks)

    def count_task_stages(self):
        task_stage_counts = {}
        for task in self.tasks:
            stage = task.stage_id.name
            if stage in task_stage_counts:
                task_stage_counts[stage] += 1
            else:
                task_stage_counts[stage] = 1
        return task_stage_counts
