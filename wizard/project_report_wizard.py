from odoo import models, fields, api , _
from odoo.http import request
from odoo.exceptions import ValidationError

class ProjectReportWizard(models.TransientModel):
    _name = 'project.date.report.wizard'
    _description = 'wizard fields for project model'

    from_date = fields.Date(string='From', index=True, copy=False, tracking=True, task_dependency_tracking=True)
    to_date = fields.Date(string='To', index=True, copy=False, tracking=True, task_dependency_tracking=True)
    wizard_display_project_id = fields.Many2one('project.project', string='Project', index=True)

    def action_print_report(self):
        # print(self.read()[0])
        if self.wizard_display_project_id and self.from_date and self.to_date:
            company_working_hours = self.env.user.company_id.resource_calendar_id.hours_per_day
            is_uom_day = request.env['account.analytic.line']._is_timesheet_encode_uom_day()
            task_data = []

            total_tasks = self.env['project.task'].search([
                ('project_id', '=', self.wizard_display_project_id.id),
                ('date_start', '>=', self.from_date),
                ('date_start', '<=', self.to_date)
            ])

            for task in total_tasks:
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

            data = {
                "project_name": self.wizard_display_project_id.name,
                "project_stage": self.wizard_display_project_id.stage_id.name,
                "project_progres": round(self.wizard_display_project_id.project_progress),
                "user_id": self.wizard_display_project_id.user_id.name,
                "partner_id": self.wizard_display_project_id.partner_id.name,
                "from_date": self.from_date,
                "to_date": self.to_date,
                "tasks_length": len(total_tasks),
                "total_tasks": task_data
            }
            report_action = self.env.ref('project_gantt.action_project_report_date_based').report_action(self, data=data)
            print(self.env.ref('project_gantt.action_project_report_date_based'))
            # report_action.update({'type': 'ir.actions.act_window_close'})
            # return {'type': 'ir.actions.act_window_close'}
            return report_action


        elif not self.wizard_display_project_id or not self.from_date or not self.to_date:
            raise ValidationError(_('All fields are required.'))
