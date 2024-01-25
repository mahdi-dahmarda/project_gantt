/** @odoo-module **/

import {Dropdown} from "@web/core/dropdown/dropdown";
import {DropdownItem} from "@web/core/dropdown/dropdown_item";
import {useService} from "@web/core/utils/hooks";
import {Layout} from "@web/search/layout";
import {GroupByMenu} from "@web/search/group_by_menu/group_by_menu";
import {useModel} from "@web/views/model";
import {standardViewProps} from "@web/views/standard_view_props";
import {useSetupView} from "@web/views/view_hook";
import {_lt, _t} from "@web/core/l10n/translation";
import {Component, useRef, useEffect} from "@odoo/owl";

const SCALE_LABELS = {
    day: _lt("Day"), week: _lt("Week"), month: _lt("Month"), quarter: _lt("Quarter"), year: _lt("Year"),
};

export class GanttController extends Component {
    setup() {
        this.actionService = useService("action");
        this.model = useModel(this.props.Model, this.props.modelParams);
        this.scale = "month"
        this.scales = ["day", "week", "month", "quarter", "year"];

        useSetupView({
            rootRef: useRef("root"), getLocalState: () => {
                return {metaData: this.model.metaData};
            }, getContext: () => this.getContext(),
        });
    }

   defaultMenuScale() {
        if (this.model.metaData.resModel === 'project.task') {
            return JSON.parse(sessionStorage.getItem("project" + this.model.metaData.context.active_id)) || "month" ;
        }
        if (this.model.metaData.resModel === 'project.project') {
            return JSON.parse(sessionStorage.getItem("projects_view")) || "month";
        }
    }

    /**
     * @returns {Object}
     */
    getContext() {
        // expand context object? change keys?
        const {measure, groupBy, mode} = this.model.metaData;
        const context = {
            graph_measure: measure, graph_mode: mode, graph_groupbys: groupBy.map((gb) => gb.spec),
        };
        if (mode !== "pie") {
            context.graph_order = this.model.metaData.order;
            context.graph_stacked = this.model.metaData.stacked;
            if (mode === "line") {
                context.graph_cumulated = this.model.metaData.cumulated;
            }
        }
        return context;
    }

    /**
     * Execute the action to open the view on the current model.
     *
     * @param {Array} domain
     * @param {Array} views
     * @param {Object} context
     */
    openView(domain, views, context) {
        this.actionService.doAction({
            context,
            domain,
            name: this.model.metaData.title,
            res_model: this.model.metaData.resModel,
            target: "new",
            type: "ir.actions.act_window",
            views,
        }, {
            viewType: "form",
        });
    }

    /**
     * @param {number} domain the domain of the clicked area
     */
    onGraphClicked(id) {
        const {context} = this.model.metaData;
        this.selectedTaskId = id;
        this.actionService.doAction({
            name: this.model.metaData.title,
            res_model: this.model.metaData.resModel,
            res_id: id,
            target: "new",
            type: "ir.actions.act_window",
            views: [[false, 'form']],
            viewType: "form",
            context: {},
            domain: [],
        }, {
            props: {
                onSave: (record, params) => {
                    this.actionService.doAction({
                        type: "ir.actions.act_window_close",
                    });
                    // this.model.updateMetaData(this.model.metaData);
                }
            }
        });


    }


    /**
     * @param {Object} param0
     * @param {string} param0.measure
     */
    onMeasureSelected({measure}) {
        this.model.updateMetaData({measure});
    }

    /**
     * @param {"day"|"week"|"month"|"quarter"|"year"} scale
     */
    /**
     * @param {"ASC"|"DESC"} order
     */

    toggleOrder(order) {
        const {order: currentOrder} = this.model.metaData;
        const nextOrder = currentOrder === order ? null : order;
        this.model.updateMetaData({order: nextOrder});
    }

    toggleStacked() {
        const {stacked} = this.model.metaData;
        this.model.updateMetaData({stacked: !stacked});
    }

    toggleCumulated() {
        const {cumulated} = this.model.metaData;
        this.model.updateMetaData({cumulated: !cumulated});
    }

    get scaleLabels() {
        return SCALE_LABELS;
    }

    setScale(scale) {
        if (this.model.metaData.resModel === "project.project") {
                  sessionStorage.setItem("projects_view", JSON.stringify(scale));
        } else if (this.model.metaData.resModel === "project.task") {
                 sessionStorage.setItem("project" + this.model.metaData.context.active_id, JSON.stringify(scale));
        }
        this.scale = scale;
        gantt.ext.zoom.setLevel(scale);
    }
}

GanttController.template = "project_gantt.GanttView";
GanttController.components = {Dropdown, DropdownItem, GroupByMenu, Layout};

GanttController.props = {
    ...standardViewProps, Model: Function, modelParams: Object, Renderer: Function, buttonTemplate: String,
};
