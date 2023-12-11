# -*- coding: utf-8 -*-
{
    "name": "Project Gantt View",
    "depends": ['project'],
    "sequence": -200,
    "data": [
        # "security/ir.model.access.csv",
        "views/views.xml",
        # "data/master_data.xml",
    ],
    "demo": [],
    'assets': {
        'web.assets_backend': [
            '/project_gantt/static/lib/dhtmlxgantt/dhtmlxgantt.css',
            '/project_gantt/static/lib/chosenjquery/chosen_min.css',
            '/project_gantt/static/lib/chosenjquery/chosen-sprite.png',
            '/project_gantt/static/lib/dhtmlxgantt/dhtmlxgantt.js',
            '/project_gantt/static/lib/chosenjquery/chosen_jquery_min.js',
            '/project_gantt/static/src/js/**/*'

        ],
    },
    "application": True,
    "license": "GPL-3",
}
