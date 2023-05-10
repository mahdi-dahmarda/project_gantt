# -*- coding: utf-8 -*-
{
    "name": "Project Gantt View",
    "depends": ['project'],
    "data": [
        # "security/ir.model.access.csv",
        "views/views.xml",
        # "data/master_data.xml",
    ],
    "demo": [],
    'assets': {
        'web.assets_backend': [
            '/project_gantt/static/src/js/**/*',
        ],
    },
    "application": True,
    "license": "GPL-3",
}
