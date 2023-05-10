/** @odoo-module **/

import { _lt } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { GanttArchParser } from "./gantt_arch_parser";
import { GanttModel } from "./gantt_model";
import { GanttController } from "./gantt_controller";
import { GanttRenderer } from "./gantt_renderer";
import { GanttSearchModel } from "./gantt_search_model";

export const ganttView = {
    type: "gantt",
    display_name: _lt("Gantt"),
    icon: "fa fa-tasks",
    multiRecord: true,
    Controller: GanttController,
    Renderer: GanttRenderer,
    Model: GanttModel,
    ArchParser: GanttArchParser,
    SearchModel: GanttSearchModel,
    searchMenuTypes: ["filter", "groupBy", "comparison", "favorite"],
    buttonTemplate: "project_gantt.GanttView.Buttons",

    props: (genericProps, view) => {
        let modelParams;
        if (genericProps.state) {
            modelParams = genericProps.state.metaData;
        } else {
            const { arch, fields, resModel } = genericProps;
            const parser = new view.ArchParser();
            const archInfo = parser.parse(arch, fields);
            modelParams = {
                disableLinking: Boolean(archInfo.disableLinking),
                fieldAttrs: archInfo.fieldAttrs,
                fields: fields,
                groupBy: archInfo.groupBy,
                measure: archInfo.measure || "__count",
                mode: archInfo.mode || "bar",
                order: archInfo.order || null,
                resModel: resModel,
                stacked: "stacked" in archInfo ? archInfo.stacked : true,
                cumulated: archInfo.cumulated || false,
                title: archInfo.title || _lt("Untitled"),
            };
        }

        return {
            ...genericProps,
            modelParams,
            Model: view.Model,
            Renderer: view.Renderer,
            buttonTemplate: view.buttonTemplate,
        };
    },
};

registry.category("views").add("gantt", ganttView);
